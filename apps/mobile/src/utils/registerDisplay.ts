/** Affiche le numéro/libellé saisi (retire le préfixe technique D{deptId}-). */
export function formatRegisterCode(code: string): string {
  const m = /^D\d+-(.+)$/.exec(code.trim());
  return m?.[1] ?? code;
}
