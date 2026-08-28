import axios from 'axios';

export function isLikelyNetworkError(err: unknown): boolean {
  if (!axios.isAxiosError(err)) return false;
  if (err.code === 'ERR_NETWORK' || err.code === 'ECONNABORTED') return true;
  return err.response === undefined;
}

function unwrapNestMessage(data: unknown, depth = 0): string | null {
  if (depth > 6 || data == null) return null;
  if (typeof data === 'string') {
    const t = data.trim();
    return t.length ? t : null;
  }
  if (Array.isArray(data)) {
    const parts = data
      .map((item) => unwrapNestMessage(item, depth + 1))
      .filter((item): item is string => Boolean(item));
    return parts.length ? parts.join(', ') : null;
  }
  if (typeof data === 'object') {
    const rec = data as Record<string, unknown>;
    return (
      unwrapNestMessage(rec.message, depth + 1) ??
      (typeof rec.error === 'string' && rec.error.trim() ? rec.error.trim() : null)
    );
  }
  return null;
}

export function formatApiError(err: unknown, fallback: string): string {
  if (axios.isAxiosError(err)) {
    const unwrapped = unwrapNestMessage(err.response?.data);
    if (unwrapped) return unwrapped;
    if (err.code === 'ERR_NETWORK' || err.code === 'ECONNABORTED' || err.response === undefined) {
      return 'Pas de réponse du serveur (réseau ou API arrêtée).';
    }
  }
  if (err instanceof Error && err.message.trim() && !/^Request failed with status code \d+$/.test(err.message)) {
    return err.message;
  }
  return fallback;
}
