import * as Crypto from 'expo-crypto';
import * as Device from 'expo-device';
import { Platform } from 'react-native';

import { secureGet, secureSet } from '@/services/secure-store';

const DEVICE_ID_KEY = 'pos_device_id';

function fallbackName() {
  const model = Device.modelName?.trim();
  const named = Device.deviceName?.trim();
  if (named) return named;
  if (model) return model;
  if (Platform.OS === 'ios') return 'iPhone';
  if (Platform.OS === 'android') return 'Android';
  return 'Mobile';
}

export async function getPosDeviceId(): Promise<string> {
  const existing = await secureGet(DEVICE_ID_KEY);
  if (existing && existing.length >= 8) return existing;
  const created = Crypto.randomUUID();
  await secureSet(DEVICE_ID_KEY, created);
  return created;
}

export function getPosDeviceName(): string {
  return fallbackName().slice(0, 120);
}
