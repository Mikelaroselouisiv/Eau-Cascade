import CoreBluetooth
import ExpoModulesCore
import Foundation

private let printerServiceUUIDs = [
  CBUUID(string: "18F0"),
  CBUUID(string: "FFF0"),
  CBUUID(string: "FFE0"),
  CBUUID(string: "49535343-FE7D-4AE5-8FA9-9FAFD205E455"),
]

private let writeCharacteristicUUIDs = [
  CBUUID(string: "2AF1"),
  CBUUID(string: "FFF2"),
  CBUUID(string: "FFE1"),
  CBUUID(string: "49535343-8841-43F4-A8D4-ECBE34729BB3"),
]

private let pairingHelp =
  "iOS a affiché un popup Bluetooth. Annulez-le : cette imprimante n’apparaît pas dans Réglages et n’a pas de code. Relancez simplement le ticket."

public class ThermalPrinterModule: Module {
  private let ble = BlePrinterController()

  public func definition() -> ModuleDefinition {
    Name("ThermalPrinter")
    Events("onDeviceFound", "onScanFinished")

    OnCreate {
      self.ble.onEvent = { [weak self] name, body in
        self?.sendEvent(name, body)
      }
    }

    Function("getTransport") { () -> String in
      "ble"
    }

    AsyncFunction("requestPermissions") { () -> Bool in
      try await self.ble.awaitReady()
      return true
    }

    AsyncFunction("startScan") { (durationMs: Int) in
      try await self.ble.startScanAsync(durationMs: durationMs)
    }

    AsyncFunction("stopScan") {
      self.ble.stopScan()
    }

    AsyncFunction("holdConnection") { (address: String) in
      try await self.ble.holdConnectionAsync(address: address)
    }

    AsyncFunction("print") { (address: String, dataBase64: String) in
      try await self.ble.printAsync(address: address, dataBase64: dataBase64)
    }

    OnDestroy {
      self.ble.tearDown()
    }
  }
}

private final class BlePrinterController: NSObject, CBCentralManagerDelegate, CBPeripheralDelegate {
  var onEvent: ((String, [String: Any]) -> Void)?

  private var central: CBCentralManager?
  private var readyWaiters: [(Error?) -> Void] = []
  private var scanWork: DispatchWorkItem?
  private var connectTimeoutWork: DispatchWorkItem?
  private var seenIds = Set<UUID>()
  private var retained: [UUID: CBPeripheral] = [:]

  private var printPeripheral: CBPeripheral?
  private var writeCharacteristic: CBCharacteristic?
  private var printCompletion: ((Error?) -> Void)?
  private var pendingChunks: [Data] = []
  private var reconnectTarget: UUID?
  private var holdOnly = false
  private var sentAnyChunk = false
  private var writesFinished = false
  private var reconnectAttempts = 0
  private var waitingForWriteReady = false

  func awaitReady() async throws {
    try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
      ensureReady { error in
        if let error {
          continuation.resume(throwing: error)
        } else {
          continuation.resume()
        }
      }
    }
  }

  func startScanAsync(durationMs: Int) async throws {
    try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
      startScan(durationMs: durationMs) { error in
        if let error {
          continuation.resume(throwing: error)
        } else {
          continuation.resume()
        }
      }
    }
  }

  func holdConnectionAsync(address: String) async throws {
    try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
      holdConnection(address: address) { error in
        if let error {
          continuation.resume(throwing: error)
        } else {
          continuation.resume()
        }
      }
    }
  }

  func printAsync(address: String, dataBase64: String) async throws {
    try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
      print(address: address, dataBase64: dataBase64) { error in
        if let error {
          continuation.resume(throwing: error)
        } else {
          continuation.resume()
        }
      }
    }
  }

  func ensureReady(_ completion: @escaping (Error?) -> Void) {
    if let central, central.state == .poweredOn {
      completion(nil)
      return
    }
    readyWaiters.append(completion)
    if central == nil {
      central = CBCentralManager(delegate: self, queue: nil)
    } else {
      reportReadyIfPossible()
    }
  }

  func startScan(durationMs: Int, completion: @escaping (Error?) -> Void) {
    ensureReady { [weak self] error in
      guard let self else { return }
      if let error {
        completion(error)
        return
      }
      guard let central = self.central else {
        completion(self.makeError("Bluetooth non disponible"))
        return
      }

      self.stopScan()
      self.seenIds.removeAll()
      self.emitAlreadyConnected(central)
      central.scanForPeripherals(withServices: nil, options: [CBCentralManagerScanOptionAllowDuplicatesKey: false])

      let seconds = TimeInterval(min(max(durationMs, 3000), 30000)) / 1000.0
      let work = DispatchWorkItem { [weak self] in
        self?.finishScan()
      }
      self.scanWork = work
      DispatchQueue.main.asyncAfter(deadline: .now() + seconds, execute: work)
      completion(nil)
    }
  }

  func stopScan() {
    scanWork?.cancel()
    scanWork = nil
    if reconnectTarget == nil {
      central?.stopScan()
    }
  }

  func holdConnection(address: String, completion: @escaping (Error?) -> Void) {
    beginSession(address: address, data: Data(), holdOnly: true, completion: completion)
  }

  func print(address: String, dataBase64: String, completion: @escaping (Error?) -> Void) {
    guard let data = Data(base64Encoded: dataBase64), !data.isEmpty else {
      completion(makeError("Ticket vide"))
      return
    }
    beginSession(address: address, data: data, holdOnly: false, completion: completion)
  }

  func tearDown() {
    stopScan()
    connectTimeoutWork?.cancel()
    connectTimeoutWork = nil
    abortInFlightPrint(nil)
    central?.delegate = nil
    central = nil
  }

  func centralManagerDidUpdateState(_ central: CBCentralManager) {
    reportReadyIfPossible()
  }

  func centralManager(
    _ central: CBCentralManager,
    didDiscover peripheral: CBPeripheral,
    advertisementData: [String: Any],
    rssi RSSI: NSNumber
  ) {
    retained[peripheral.identifier] = peripheral
    if reconnectTarget == peripheral.identifier, let central = self.central {
      central.stopScan()
      reconnectTarget = nil
      connectForPrint(peripheral, central: central)
      return
    }
    if seenIds.contains(peripheral.identifier) { return }
    seenIds.insert(peripheral.identifier)

    let advertised = (advertisementData[CBAdvertisementDataServiceUUIDsKey] as? [CBUUID]) ?? []
    let looksLikePrinter = advertised.contains { uuid in
      printerServiceUUIDs.contains(uuid)
    }
    let name = peripheral.name ?? (advertisementData[CBAdvertisementDataLocalNameKey] as? String)
    if name == nil && !looksLikePrinter { return }

    var payload: [String: Any] = [
      "id": peripheral.identifier.uuidString,
      "rssi": RSSI.intValue,
      "transport": "ble",
    ]
    if let name {
      payload["name"] = name
    }
    onEvent?("onDeviceFound", payload)
  }

  func centralManager(_ central: CBCentralManager, didConnect peripheral: CBPeripheral) {
    guard peripheral.identifier == printPeripheral?.identifier else { return }
    peripheral.delegate = self
    if writeCharacteristic != nil, !holdOnly, !pendingChunks.isEmpty {
      writeNextChunk()
      return
    }
    writeCharacteristic = nil
    peripheral.discoverServices(printerServiceUUIDs)
  }

  func centralManager(_ central: CBCentralManager, didFailToConnect peripheral: CBPeripheral, error: Error?) {
    guard peripheral.identifier == printPeripheral?.identifier else { return }
    abortInFlightPrint(pairingOr(error, fallback: "Connexion Bluetooth impossible"))
  }

  func centralManager(_ central: CBCentralManager, didDisconnectPeripheral peripheral: CBPeripheral, error: Error?) {
    guard peripheral.identifier == printPeripheral?.identifier else { return }
    writeCharacteristic = nil
    waitingForWriteReady = false

    if writesFinished || (printCompletion != nil && sentAnyChunk && pendingChunks.isEmpty) {
      finishPrintSuccess()
      return
    }
    if printCompletion == nil {
      return
    }
    abortInFlightPrint(pairingOr(error, fallback: "Imprimante déconnectée"))
  }

  func peripheral(_ peripheral: CBPeripheral, didDiscoverServices error: Error?) {
    if let error {
      abortInFlightPrint(pairingOr(error, fallback: error.localizedDescription))
      return
    }
    let found = peripheral.services ?? []
    if found.isEmpty {
      abortInFlightPrint(makeError("Service d'impression BLE introuvable"))
      return
    }
    let ordered = found.sorted { rank(service: $0.uuid) < rank(service: $1.uuid) }
    for service in ordered {
      peripheral.discoverCharacteristics(writeCharacteristicUUIDs, for: service)
    }
  }

  func peripheral(_ peripheral: CBPeripheral, didDiscoverCharacteristicsFor service: CBService, error: Error?) {
    if let error {
      abortInFlightPrint(pairingOr(error, fallback: error.localizedDescription))
      return
    }
    guard writeCharacteristic == nil else { return }
    let services = peripheral.services ?? []
    if services.contains(where: { $0.characteristics == nil }) { return }

    let ordered = services.sorted { rank(service: $0.uuid) < rank(service: $1.uuid) }
    let candidates = ordered.flatMap { $0.characteristics ?? [] }
    guard let characteristic = pickWriteCharacteristic(candidates) else {
      abortInFlightPrint(makeError("Caractéristique d'écriture BLE introuvable"))
      return
    }
    writeCharacteristic = characteristic
    if holdOnly {
      finishPrintSuccess()
      return
    }
    writeNextChunk()
  }

  func peripheral(_ peripheral: CBPeripheral, didWriteValueFor characteristic: CBCharacteristic, error: Error?) {
    if let error {
      abortInFlightPrint(pairingOr(error, fallback: error.localizedDescription))
      return
    }
    writeNextChunk()
  }

  func peripheralIsReady(toSendWriteWithoutResponse peripheral: CBPeripheral) {
    guard waitingForWriteReady else { return }
    waitingForWriteReady = false
    writeNextChunk()
  }

  private func beginSession(
    address: String,
    data: Data,
    holdOnly: Bool,
    completion: @escaping (Error?) -> Void
  ) {
    guard let uuid = UUID(uuidString: address.trimmingCharacters(in: .whitespacesAndNewlines)) else {
      completion(makeError("Adresse imprimante invalide"))
      return
    }

    ensureReady { [weak self] error in
      guard let self else { return }
      if let error {
        completion(error)
        return
      }
      guard let central = self.central else {
        completion(self.makeError("Bluetooth non disponible"))
        return
      }

      self.abortInFlightPrint(nil)
      self.printCompletion = completion
      self.pendingChunks = holdOnly ? [] : Self.chunk(data, size: 20)
      self.holdOnly = holdOnly
      self.sentAnyChunk = false
      self.writesFinished = false
      self.reconnectAttempts = 0
      self.waitingForWriteReady = false
      self.scheduleConnectTimeout()

      if self.printPeripheral?.identifier == uuid,
         self.printPeripheral?.state == .connected,
         self.writeCharacteristic != nil {
        if holdOnly {
          self.finishPrintSuccess()
        } else {
          self.writeNextChunk()
        }
        return
      }

      if let connected = self.findConnected(uuid, central: central) {
        self.connectForPrint(connected, central: central)
        return
      }

      let known = self.retained[uuid] ?? central.retrievePeripherals(withIdentifiers: [uuid]).first
      if let known {
        self.connectForPrint(known, central: central)
        return
      }

      self.reconnectTarget = uuid
      central.scanForPeripherals(withServices: nil, options: [CBCentralManagerScanOptionAllowDuplicatesKey: false])
    }
  }

  private func writeNextChunk() {
    guard let peripheral = printPeripheral, let characteristic = writeCharacteristic else {
      abortInFlightPrint(makeError("Imprimante non prête"))
      return
    }
    if pendingChunks.isEmpty {
      writesFinished = true
      DispatchQueue.main.asyncAfter(deadline: .now() + 0.25) { [weak self] in
        self?.finishPrintSuccess()
      }
      return
    }

    connectTimeoutWork?.cancel()
    connectTimeoutWork = nil

    if !peripheral.canSendWriteWithoutResponse {
      waitingForWriteReady = true
      return
    }

    let chunk = pendingChunks.removeFirst()
    sentAnyChunk = true
    peripheral.writeValue(chunk, for: characteristic, type: .withoutResponse)
    if peripheral.canSendWriteWithoutResponse {
      DispatchQueue.main.asyncAfter(deadline: .now() + 0.02) { [weak self] in
        self?.writeNextChunk()
      }
    } else {
      waitingForWriteReady = true
    }
  }

  private func connectForPrint(_ peripheral: CBPeripheral, central: CBCentralManager) {
    retained[peripheral.identifier] = peripheral
    printPeripheral = peripheral
    peripheral.delegate = self
    if peripheral.state == .connected {
      if writeCharacteristic != nil {
        if holdOnly {
          finishPrintSuccess()
        } else {
          writeNextChunk()
        }
      } else {
        peripheral.discoverServices(printerServiceUUIDs)
      }
      return
    }

    central.connect(peripheral, options: [
      CBConnectPeripheralOptionNotifyOnDisconnectionKey: false,
    ])
  }

  private func findConnected(_ uuid: UUID, central: CBCentralManager) -> CBPeripheral? {
    let connected = central.retrieveConnectedPeripherals(withServices: printerServiceUUIDs)
    return connected.first { $0.identifier == uuid }
  }

  private func scheduleConnectTimeout() {
    connectTimeoutWork?.cancel()
    let work = DispatchWorkItem { [weak self] in
      guard let self, self.printCompletion != nil, !self.sentAnyChunk else { return }
      self.abortInFlightPrint(self.makeError(pairingHelp))
    }
    connectTimeoutWork = work
    DispatchQueue.main.asyncAfter(deadline: .now() + 25, execute: work)
  }

  private func finishPrintSuccess() {
    connectTimeoutWork?.cancel()
    connectTimeoutWork = nil
    let done = printCompletion
    printCompletion = nil
    reconnectTarget = nil
    holdOnly = false
    writesFinished = true
    pendingChunks.removeAll()
    done?(nil)
  }

  private func abortInFlightPrint(_ error: Error?) {
    connectTimeoutWork?.cancel()
    connectTimeoutWork = nil
    let done = printCompletion
    printCompletion = nil
    pendingChunks.removeAll()
    reconnectTarget = nil
    holdOnly = false
    waitingForWriteReady = false
    central?.stopScan()
    if error != nil, let peripheral = printPeripheral, let central, peripheral.state != .disconnected {
      central.cancelPeripheralConnection(peripheral)
    }
    if let done, let error {
      done(error)
    }
  }

  private func finishScan() {
    stopScan()
    onEvent?("onScanFinished", [:])
  }

  private func emitAlreadyConnected(_ central: CBCentralManager) {
    let connected = central.retrieveConnectedPeripherals(withServices: printerServiceUUIDs)
    for peripheral in connected {
      if seenIds.contains(peripheral.identifier) { continue }
      seenIds.insert(peripheral.identifier)
      retained[peripheral.identifier] = peripheral
      var payload: [String: Any] = [
        "id": peripheral.identifier.uuidString,
        "transport": "ble",
      ]
      if let name = peripheral.name {
        payload["name"] = name
      }
      onEvent?("onDeviceFound", payload)
    }
  }

  private func reportReadyIfPossible() {
    guard let central else { return }
    switch central.state {
    case .poweredOn:
      flushReady(nil)
    case .unauthorized:
      flushReady(makeError(
        "Bluetooth refusé pour cette app. iPhone : Réglages → POS Eau Cascade → Bluetooth.",
      ))
    case .poweredOff:
      flushReady(makeError("Bluetooth désactivé"))
    case .unsupported:
      flushReady(makeError("Bluetooth non disponible sur cet appareil"))
    default:
      break
    }
  }

  private func flushReady(_ error: Error?) {
    let waiters = readyWaiters
    readyWaiters.removeAll()
    waiters.forEach { $0(error) }
  }

  private func pickWriteCharacteristic(_ characteristics: [CBCharacteristic]) -> CBCharacteristic? {
    let writable = characteristics.filter {
      $0.properties.contains(.writeWithoutResponse) || $0.properties.contains(.write)
    }
    let noResponse = writable.filter { $0.properties.contains(.writeWithoutResponse) }
    let pool = noResponse.isEmpty ? writable : noResponse
    if let preferred = pool.first(where: { char in
      writeCharacteristicUUIDs.contains(char.uuid)
    }) {
      return preferred
    }
    return pool.first
  }

  private func rank(service uuid: CBUUID) -> Int {
    if let index = printerServiceUUIDs.firstIndex(of: uuid) {
      return index
    }
    return printerServiceUUIDs.count + 1
  }

  private static func chunk(_ data: Data, size: Int) -> [Data] {
    guard !data.isEmpty else { return [] }
    var chunks: [Data] = []
    var offset = 0
    while offset < data.count {
      let end = min(offset + size, data.count)
      chunks.append(data.subdata(in: offset..<end))
      offset = end
    }
    return chunks
  }

  private func isPairingError(_ error: Error?) -> Bool {
    guard let ns = error as NSError? else { return false }
    if ns.domain == CBErrorDomain, [10, 14, 15].contains(ns.code) {
      return true
    }
    if ns.domain == CBATTErrorDomain, [5, 8, 15].contains(ns.code) {
      return true
    }
    let msg = ns.localizedDescription.lowercased()
    return msg.contains("encrypt") || msg.contains("pair") || msg.contains("auth") || msg.contains("bond")
      || msg.contains("jumel")
  }

  private func pairingOr(_ error: Error?, fallback: String) -> NSError {
    if isPairingError(error) || !sentAnyChunk {
      return makeError(pairingHelp)
    }
    if let error {
      return error as NSError
    }
    return makeError(fallback)
  }

  private func makeError(_ message: String) -> NSError {
    NSError(domain: "ThermalPrinter", code: 1, userInfo: [NSLocalizedDescriptionKey: message])
  }
}
