package expo.modules.thermalprinter

import android.Manifest
import android.annotation.SuppressLint
import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothDevice
import android.bluetooth.BluetoothManager
import android.bluetooth.BluetoothSocket
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.util.Base64
import androidx.core.content.ContextCompat
import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.util.UUID
import java.util.concurrent.Executors

class ThermalPrinterModule : Module() {
  private val io = Executors.newSingleThreadExecutor()
  private val main = Handler(Looper.getMainLooper())
  private var receiver: BroadcastReceiver? = null
  private var scanTimeout: Runnable? = null

  private val context: Context
    get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()

  override fun definition() = ModuleDefinition {
    Name("ThermalPrinter")
    Events("onDeviceFound", "onScanFinished")

    Function("getTransport") { "classic" }

    AsyncFunction("requestPermissions") { promise: Promise ->
      promise.resolve(hasBluetoothPermission())
    }

    AsyncFunction("startScan") { durationMs: Int, promise: Promise ->
      try {
        startClassicScan(durationMs)
        promise.resolve(null)
      } catch (e: Exception) {
        promise.reject("SCAN_ERROR", e.message, e)
      }
    }

    AsyncFunction("stopScan") { promise: Promise ->
      stopClassicScan()
      promise.resolve(null)
    }

    AsyncFunction("holdConnection") { _address: String, promise: Promise ->
      promise.resolve(null)
    }

    AsyncFunction("print") { address: String, dataBase64: String, promise: Promise ->
      io.execute {
        try {
          printClassic(address, dataBase64)
          promise.resolve(null)
        } catch (e: Exception) {
          promise.reject("PRINT_ERROR", e.message ?: "Échec de l'impression", e)
        }
      }
    }

    OnDestroy {
      stopClassicScan()
      io.shutdown()
    }
  }

  private fun adapter(): BluetoothAdapter {
    val manager = context.getSystemService(Context.BLUETOOTH_SERVICE) as BluetoothManager
    return manager.adapter ?: throw IllegalStateException("Bluetooth non disponible sur cet appareil")
  }

  private fun hasBluetoothPermission(): Boolean {
    return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
      ContextCompat.checkSelfPermission(context, Manifest.permission.BLUETOOTH_CONNECT) == PackageManager.PERMISSION_GRANTED &&
        ContextCompat.checkSelfPermission(context, Manifest.permission.BLUETOOTH_SCAN) == PackageManager.PERMISSION_GRANTED
    } else {
      ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED
    }
  }

  @SuppressLint("MissingPermission")
  private fun emitDevice(device: BluetoothDevice, rssi: Int?) {
    val name = try {
      device.name
    } catch (_: SecurityException) {
      null
    }
    sendEvent(
      "onDeviceFound",
      mapOf(
        "id" to device.address,
        "name" to name,
        "rssi" to rssi,
        "transport" to "classic",
      ),
    )
  }

  @SuppressLint("MissingPermission")
  private fun startClassicScan(durationMs: Int) {
    if (!hasBluetoothPermission()) {
      throw IllegalStateException("Permissions Bluetooth refusées")
    }
    val bt = adapter()
    if (!bt.isEnabled) {
      throw IllegalStateException("Bluetooth désactivé")
    }

    stopClassicScan()

    try {
      bt.bondedDevices?.forEach { emitDevice(it, null) }
    } catch (_: SecurityException) {
    }

    val rec = object : BroadcastReceiver() {
      override fun onReceive(ctx: Context?, intent: Intent?) {
        when (intent?.action) {
          BluetoothDevice.ACTION_FOUND -> {
            val device = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
              intent.getParcelableExtra(BluetoothDevice.EXTRA_DEVICE, BluetoothDevice::class.java)
            } else {
              @Suppress("DEPRECATION")
              intent.getParcelableExtra(BluetoothDevice.EXTRA_DEVICE)
            } ?: return
            val rssi = intent.getShortExtra(BluetoothDevice.EXTRA_RSSI, Short.MIN_VALUE).toInt()
            emitDevice(device, if (rssi == Short.MIN_VALUE.toInt()) null else rssi)
          }
          BluetoothAdapter.ACTION_DISCOVERY_FINISHED -> {
            finishScan()
          }
        }
      }
    }
    receiver = rec
    val filter = IntentFilter().apply {
      addAction(BluetoothDevice.ACTION_FOUND)
      addAction(BluetoothAdapter.ACTION_DISCOVERY_FINISHED)
    }
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
      context.registerReceiver(rec, filter, Context.RECEIVER_NOT_EXPORTED)
    } else {
      context.registerReceiver(rec, filter)
    }

    try {
      if (bt.isDiscovering) bt.cancelDiscovery()
      bt.startDiscovery()
    } catch (e: SecurityException) {
      stopClassicScan()
      throw IllegalStateException("Impossible de scanner — permission Bluetooth manquante")
    }

    val timeout = Runnable { finishScan() }
    scanTimeout = timeout
    main.postDelayed(timeout, durationMs.coerceIn(3000, 30000).toLong())
  }

  @SuppressLint("MissingPermission")
  private fun finishScan() {
    val timeout = scanTimeout
    if (timeout != null) {
      main.removeCallbacks(timeout)
      scanTimeout = null
    }
    try {
      adapter().cancelDiscovery()
    } catch (_: Exception) {
    }
    val rec = receiver
    if (rec != null) {
      try {
        context.unregisterReceiver(rec)
      } catch (_: Exception) {
      }
      receiver = null
    }
    sendEvent("onScanFinished", emptyMap<String, Any>())
  }

  @SuppressLint("MissingPermission")
  private fun stopClassicScan() {
    val timeout = scanTimeout
    if (timeout != null) {
      main.removeCallbacks(timeout)
      scanTimeout = null
    }
    try {
      adapter().cancelDiscovery()
    } catch (_: Exception) {
    }
    val rec = receiver
    if (rec != null) {
      try {
        context.unregisterReceiver(rec)
      } catch (_: Exception) {
      }
      receiver = null
    }
  }

  @SuppressLint("MissingPermission")
  private fun printClassic(address: String, dataBase64: String) {
    if (!hasBluetoothPermission()) {
      throw IllegalStateException("Permissions Bluetooth refusées")
    }
    val mac = address.trim()
    if (!BluetoothAdapter.checkBluetoothAddress(mac)) {
      throw IllegalStateException("Adresse imprimante invalide")
    }
    val bytes = Base64.decode(dataBase64, Base64.DEFAULT)
    if (bytes.isEmpty()) {
      throw IllegalStateException("Ticket vide")
    }

    val bt = adapter()
    if (!bt.isEnabled) {
      throw IllegalStateException("Bluetooth désactivé")
    }
    try {
      if (bt.isDiscovering) bt.cancelDiscovery()
    } catch (_: Exception) {
    }

    val device = bt.getRemoteDevice(mac)
    val socket = openSppSocket(device)
    try {
      // Many V-WRP firmwares ignore a Classic socket that is still coming up.
      Thread.sleep(300)
      writeEscPos(socket, bytes)
    } finally {
      try {
        socket.close()
      } catch (_: Exception) {
      }
    }
  }

  /**
   * Classic SPP must stay a raw byte pipe. A single write + quick close drops the
   * GS v 0 raster / GS V cut tail, which the printer then prints as garbage.
   * Insecure RFCOMM first: a "successful" encrypted socket looks like random text.
   */
  private fun writeEscPos(socket: BluetoothSocket, bytes: ByteArray) {
    val out = socket.outputStream
    val chunkSize = 512
    var offset = 0
    while (offset < bytes.size) {
      val n = minOf(chunkSize, bytes.size - offset)
      out.write(bytes, offset, n)
      out.flush()
      offset += n
      if (offset < bytes.size) {
        Thread.sleep(20)
      }
    }
    val drainMs = (400L + bytes.size / 16L).coerceIn(500L, 2500L)
    Thread.sleep(drainMs)
  }

  @SuppressLint("MissingPermission")
  private fun openSppSocket(device: BluetoothDevice): BluetoothSocket {
    val attempts = listOf(
      { device.createInsecureRfcommSocketToServiceRecord(SPP_UUID) },
      {
        val method = device.javaClass.getMethod("createInsecureRfcommSocket", Int::class.javaPrimitiveType)
        method.invoke(device, 1) as BluetoothSocket
      },
      { device.createRfcommSocketToServiceRecord(SPP_UUID) },
      {
        val method = device.javaClass.getMethod("createRfcommSocket", Int::class.javaPrimitiveType)
        method.invoke(device, 1) as BluetoothSocket
      },
    )
    var last: Exception? = null
    for (factory in attempts) {
      var socket: BluetoothSocket? = null
      try {
        socket = factory()
        socket.connect()
        return socket
      } catch (e: Exception) {
        last = e
        try {
          socket?.close()
        } catch (_: Exception) {
        }
      }
    }
    throw IllegalStateException(last?.message ?: "Connexion Bluetooth impossible")
  }

  companion object {
    private val SPP_UUID: UUID = UUID.fromString("00001101-0000-1000-8000-00805F9B34FB")
  }
}
