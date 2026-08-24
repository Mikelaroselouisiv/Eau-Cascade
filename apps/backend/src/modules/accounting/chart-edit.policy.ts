/**
 * Édition libre du plan comptable (ajout / modification / retrait via API).
 * Désactivée par défaut : les comptes viennent du code (`chart-of-accounts.ts`).
 * Pour réactiver : ACCOUNTING_ALLOW_CHART_EDIT=true
 */
export function isChartOfAccountsEditEnabled(): boolean {
  return process.env.ACCOUNTING_ALLOW_CHART_EDIT === 'true';
}

export const CHART_EDIT_DISABLED_MESSAGE =
  'Modification du plan comptable désactivée. Les comptes sont définis en dur dans le code.';
