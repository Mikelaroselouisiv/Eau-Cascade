import type { ReactNode } from 'react';
import { useCallback, useState } from 'react';
import { useFocusEffect, useLocalSearchParams } from 'expo-router';

import { AccountingOverviewScreen } from './AccountingOverviewScreen';
import { AccountingJournalScreen } from './AccountingJournalScreen';
import { AccountingLedgerScreen } from './AccountingLedgerScreen';
import { AccountingReportScreen } from './AccountingReportScreen';
import { AccountingSubTabs } from './AccountingSubTabs';

type ConsulterView = 'apercu' | 'journal' | 'grand-livre' | 'balance' | 'bilan' | 'resultat';

const TABS: Array<{ id: ConsulterView; label: string }> = [
  { id: 'apercu', label: 'Aperçu' },
  { id: 'journal', label: 'Journal' },
  { id: 'grand-livre', label: 'Grand livre' },
  { id: 'balance', label: 'Balance' },
  { id: 'bilan', label: 'Bilan' },
  { id: 'resultat', label: 'Résultat' },
];

function parseView(raw: string | string[] | undefined): ConsulterView {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (TABS.some((t) => t.id === value)) return value as ConsulterView;
  return 'apercu';
}

export function AccountingConsulterScreen() {
  const { view: viewParam } = useLocalSearchParams<{ view?: string }>();
  const [view, setView] = useState<ConsulterView>(() => parseView(viewParam));

  useFocusEffect(
    useCallback(() => {
      if (viewParam) setView(parseView(viewParam));
    }, [viewParam]),
  );

  const extraHeader = <AccountingSubTabs items={TABS} value={view} onChange={setView} />;

  let body: ReactNode;
  switch (view) {
    case 'journal':
      body = <AccountingJournalScreen extraHeader={extraHeader} />;
      break;
    case 'grand-livre':
      body = <AccountingLedgerScreen extraHeader={extraHeader} />;
      break;
    case 'balance':
      body = <AccountingReportScreen kind="balance" extraHeader={extraHeader} />;
      break;
    case 'bilan':
      body = <AccountingReportScreen kind="bilan" extraHeader={extraHeader} />;
      break;
    case 'resultat':
      body = <AccountingReportScreen kind="resultat" extraHeader={extraHeader} />;
      break;
    default:
      body = <AccountingOverviewScreen extraHeader={extraHeader} />;
  }

  return body;
}
