const DEFAULT_PROD_URL = 'http://35.203.5.250';

/** Équivalent mobile du `VITE_API_URL` desktop — surchargeable via .env (EXPO_PUBLIC_API_URL). */
export function resolveApiBaseUrl(): string {
  const override = process.env.EXPO_PUBLIC_API_URL?.trim();
  return override || DEFAULT_PROD_URL;
}
