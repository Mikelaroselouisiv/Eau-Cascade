import { Buffer } from 'buffer';
import { PermissionsAndroid, Platform } from 'react-native';

import {
  getNativePrinter,
  getPlatformTransport,
  isThermalPrinterNativeAvailable,
  type PrinterTransport,
  type ThermalPrinterDevice,
} from '../../modules/thermal-printer';
import { getDb } from './db';
import { buildEscPosPayload, type SaleReceiptData } from './escpos';

export type { PrinterTransport, ThermalPrinterDevice };

export interface SavedPrinter {
  address: string;
  name: string | null;
  paperWidth: 58 | 80;
  transport: PrinterTransport;
}

export async function requestBluetoothPermissions(): Promise<boolean> {
  if (!isThermalPrinterNativeAvailable()) {
    throw new Error(
      "Module imprimante absent. Reconstruisez l’application native (pas Expo Go).",
    );
  }

  if (Platform.OS !== 'android') {
    return getNativePrinter().requestPermissions();
  }

  const api = typeof Platform.Version === 'number' ? Platform.Version : 0;
  const needed =
    api >= 31
      ? [
          PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
          PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
        ].filter(Boolean)
      : [PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION].filter(Boolean);

  if (needed.length === 0) {
    return getNativePrinter().requestPermissions();
  }

  const granted = await PermissionsAndroid.requestMultiple(needed);
  const ok = needed.every((key) => granted[key] === PermissionsAndroid.RESULTS.GRANTED);
  if (!ok) {
    throw new Error(
      'Bluetooth refusé. Android : Réglages → Applications → POS Eau Cascade → Autorisations → Appareils à proximité.',
    );
  }
  return getNativePrinter().requestPermissions();
}

export function subscribePrinterScan(
  onDevice: (device: ThermalPrinterDevice) => void,
  onFinished: () => void,
): () => void {
  if (!isThermalPrinterNativeAvailable()) return () => undefined;
  const native = getNativePrinter();
  const found = native.addListener('onDeviceFound', onDevice);
  const done = native.addListener('onScanFinished', onFinished);
  return () => {
    found.remove();
    done.remove();
  };
}

export async function startPrinterScan(durationMs = 12000): Promise<void> {
  await getNativePrinter().startScan(durationMs);
}

export async function stopPrinterScan(): Promise<void> {
  if (!isThermalPrinterNativeAvailable()) return;
  await getNativePrinter().stopScan();
}

/** Garde le lien BLE ouvert pour éviter le dialogue de jumelage à chaque ticket. */
export async function holdPrinterConnection(address: string): Promise<void> {
  if (!isThermalPrinterNativeAvailable()) return;
  const native = getNativePrinter();
  if (typeof native.holdConnection !== 'function') return;
  await native.holdConnection(address);
}

export async function getSavedPrinter(): Promise<SavedPrinter | null> {
  const row = await getDb().getFirstAsync<{
    device_address: string | null;
    device_name: string | null;
    paper_width: number;
    transport: string | null;
  }>('SELECT device_address, device_name, paper_width, transport FROM printer_settings WHERE id = 1');
  if (!row?.device_address) return null;
  return {
    address: row.device_address,
    name: row.device_name,
    paperWidth: 80,
    transport: row.transport === 'ble' ? 'ble' : 'classic',
  };
}

export async function saveSelectedPrinter(device: {
  address: string;
  name: string | null;
  transport?: PrinterTransport;
}): Promise<void> {
  await getDb().runAsync(
    'INSERT OR REPLACE INTO printer_settings (id, device_address, device_name, paper_width, transport) VALUES (1, ?, ?, ?, ?)',
    device.address,
    device.name,
    80,
    device.transport ?? getPlatformTransport(),
  );
}

export async function getLocalPaperWidth(): Promise<58 | 80> {
  return 80;
}

export async function savePaperWidth(paperWidth: 58 | 80): Promise<void> {
  const row = await getDb().getFirstAsync<{ id: number }>(
    'SELECT id FROM printer_settings WHERE id = 1',
  );
  if (row) {
    await getDb().runAsync('UPDATE printer_settings SET paper_width = ? WHERE id = 1', paperWidth);
    return;
  }
  await getDb().runAsync(
    'INSERT INTO printer_settings (id, device_address, device_name, paper_width, transport) VALUES (1, NULL, NULL, ?, ?)',
    paperWidth,
    getPlatformTransport(),
  );
}

export async function clearSavedPrinter(): Promise<void> {
  const existing = await getSavedPrinter();
  await getDb().runAsync(
    'INSERT OR REPLACE INTO printer_settings (id, device_address, device_name, paper_width, transport) VALUES (1, NULL, NULL, ?, ?)',
    80,
    existing?.transport ?? getPlatformTransport(),
  );
}

/** Formate le ticket ESC/POS puis l'envoie à l'imprimante Bluetooth enregistrée. */
export async function printReceipt(saleData: SaleReceiptData): Promise<void> {
  const saved = await getSavedPrinter();
  if (!saved) throw new Error('Aucune imprimante Bluetooth configurée');

  const payload = await buildEscPosPayload({ ...saleData, paperWidth: 80 });
  const base64 = Buffer.from(payload).toString('base64');
  await getNativePrinter().print(saved.address, base64);
}
