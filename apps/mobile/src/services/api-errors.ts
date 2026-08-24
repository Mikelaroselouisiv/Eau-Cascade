import axios from 'axios';

export function isLikelyNetworkError(err: unknown): boolean {
  if (!axios.isAxiosError(err)) return false;
  if (err.code === 'ERR_NETWORK' || err.code === 'ECONNABORTED') return true;
  return err.response === undefined;
}

/** Message métier lisible (jamais un écran vide silencieux). */
export function formatApiError(err: unknown, fallback: string): string {
  if (axios.isAxiosError(err)) {
    const d = err.response?.data;
    if (typeof d === 'string' && d.trim()) return d;
    if (d && typeof d === 'object') {
      const m = (d as { message?: unknown }).message;
      if (typeof m === 'string' && m.trim()) return m;
      if (Array.isArray(m)) return m.filter((x) => typeof x === 'string').join(', ');
    }
    if (err.code === 'ERR_NETWORK' || err.code === 'ECONNABORTED' || err.response === undefined) {
      return 'Pas de réponse du serveur (réseau ou API arrêtée).';
    }
  }
  return err instanceof Error && err.message ? err.message : fallback;
}
