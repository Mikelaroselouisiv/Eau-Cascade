import { formatMoney } from '@/utils/datetime';

export function formatMoneyIfPositive(value: number | string | null | undefined): string {
  const n = Number(value ?? 0);
  if (!Number.isFinite(n) || n === 0) return '';
  return formatMoney(n);
}

export function journalRef(code: string, entryNumber: number): string {
  return `${code}-${String(entryNumber).padStart(5, '0')}`;
}

export const COA_CLASS_LABELS: Record<number, string> = {
  1: 'Financement',
  2: 'Immobilisations',
  3: 'Stocks',
  4: 'Tiers',
  5: 'Trésorerie',
  6: 'Charges',
  7: 'Produits',
};
