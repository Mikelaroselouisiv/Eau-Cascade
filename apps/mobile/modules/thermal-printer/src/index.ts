import { Platform } from 'react-native';
import { requireNativeModule } from 'expo-modules-core';

export type PrinterTransport = 'classic' | 'ble';

export type ThermalPrinterDevice = {
  id: string;
  name: string | null;
  rssi?: number;
  transport: PrinterTransport;
};

type DeviceFoundHandler = (device: ThermalPrinterDevice) => void;
type ScanFinishedHandler = () => void;

type EventSub = { remove: () => void };

type ThermalPrinterNative = {
  getTransport(): PrinterTransport;
  requestPermissions(): Promise<boolean>;
  startScan(durationMs: number): Promise<void>;
  stopScan(): Promise<void>;
  holdConnection(address: string): Promise<void>;
  print(address: string, dataBase64: string): Promise<void>;
  addListener(event: 'onDeviceFound', handler: DeviceFoundHandler): EventSub;
  addListener(event: 'onScanFinished', handler: ScanFinishedHandler): EventSub;
};

function loadNative(): ThermalPrinterNative | null {
  if (Platform.OS === 'web') return null;
  try {
    return requireNativeModule('ThermalPrinter') as ThermalPrinterNative;
  } catch {
    return null;
  }
}

const native = loadNative();

export function isThermalPrinterNativeAvailable(): boolean {
  return native != null;
}

export function getNativePrinter(): ThermalPrinterNative {
  if (!native) {
    throw new Error(
      "Le module d'impression n'est pas disponible. Reconstruisez l'application (dev client / APK / IPA).",
    );
  }
  return native;
}

export function getPlatformTransport(): PrinterTransport {
  if (native) return native.getTransport();
  return Platform.OS === 'ios' ? 'ble' : 'classic';
}

export default native;
