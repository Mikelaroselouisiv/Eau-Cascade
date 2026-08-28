/** Normalise un code de rôle : MAJUSCULES, `_`, sans accents ni ponctuation. */
export function normalizeRoleCode(value: unknown): string {
  return String(value ?? '')
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[\s-]+/g, '_')
    .replace(/[^A-Z0-9_]/g, '')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');
}

export function isValidRoleCode(code: string): boolean {
  return /^[A-Z][A-Z0-9_]{1,39}$/.test(code);
}
