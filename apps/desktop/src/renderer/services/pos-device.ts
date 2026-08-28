const DEVICE_ID_KEY = 'pos.deviceId';

function randomId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `dev-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function getPosDeviceId(): string {
  try {
    const existing = localStorage.getItem(DEVICE_ID_KEY);
    if (existing && existing.length >= 8) return existing;
    const created = randomId();
    localStorage.setItem(DEVICE_ID_KEY, created);
    return created;
  } catch {
    return randomId();
  }
}

export function getPosDeviceName(): string {
  const platform =
    typeof navigator !== 'undefined' ? navigator.platform?.trim() || '' : '';
  return (platform ? `POS ${platform}` : 'POS Desktop').slice(0, 120);
}
