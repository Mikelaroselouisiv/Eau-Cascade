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
  if (Platform.OS !== 'android') {
    if (!isThermalPrinterNativeAvailable()) return false;
    try {
      return await getNativePrinter().requestPermissions();
    } catch {
      return false;
    }
  }

  const permissions =
    typeof Platform.Version === 'number' && Platform.Version >= 31
      ? [
          PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
          PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
        ]
      : [PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION];

  const granted = await PermissionsAndroid.requestMultiple(permissions);
  return Object.values(granted).every((v) => v === PermissionsAndroid.RESULTS.GRANTED);
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
    paperWidth: row.paper_width === 80 ? 80 : 58,
    transport: row.transport === 'ble' ? 'ble' : 'classic',
  };
}

export async function saveSelectedPrinter(device: {
  address: string;
  name: string | null;
  transport?: PrinterTransport;
}): Promise<void> {
  const existing = await getSavedPrinter();
  await getDb().runAsync(
    'INSERT OR REPLACE INTO printer_settings (id, device_address, device_name, paper_width, transport) VALUES (1, ?, ?, ?, ?)',
    device.address,
    device.name,
    existing?.paperWidth ?? 58,
    device.transport ?? getPlatformTransport(),
  );
}

export async function getLocalPaperWidth(): Promise<58 | 80> {
  const row = await getDb().getFirstAsync<{ paper_width: number }>(
    'SELECT paper_width FROM printer_settings WHERE id = 1',
  );
  return row?.paper_width === 80 ? 80 : 58;
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
    existing?.paperWidth ?? 58,
    existing?.transport ?? getPlatformTransport(),
  );
}

/** Formate le ticket ESC/POS puis l'envoie à l'imprimante Bluetooth enregistrée. */
export async function printReceipt(saleData: SaleReceiptData): Promise<void> {
  const saved = await getSavedPrinter();
  if (!saved) throw new Error('Aucune imprimante Bluetooth configurée');

  const payload = await buildEscPosPayload({ ...saleData, paperWidth: saved.paperWidth });
  const base64 = Buffer.from(payload).toString('base64');
  await getNativePrinter().print(saved.address, base64);
}
