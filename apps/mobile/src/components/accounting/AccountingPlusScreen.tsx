import type { ReactNode } from 'react';
import { useState } from 'react';

import { AccountingAssetsScreen } from './AccountingAssetsScreen';
import { AccountingBackfillScreen } from './AccountingBackfillScreen';
import { AccountingChartScreen } from './AccountingChartScreen';
import { AccountingFiscalYearsScreen } from './AccountingFiscalYearsScreen';
import { AccountingSubTabs } from './AccountingSubTabs';
import { AccountingSuppliersScreen } from './AccountingSuppliersScreen';

type PlusView = 'exercices' | 'plan' | 'reprise' | 'fournisseurs' | 'immos';

const TABS: Array<{ id: PlusView; label: string }> = [
  { id: 'exercices', label: 'Exercices' },
  { id: 'plan', label: 'Plan' },
  { id: 'reprise', label: 'Reprise' },
  { id: 'fournisseurs', label: 'Fournisseurs' },
  { id: 'immos', label: 'Immos' },
];

export function AccountingPlusScreen() {
  const [view, setView] = useState<PlusView>('exercices');
  const extraHeader = <AccountingSubTabs items={TABS} value={view} onChange={setView} />;

  let body: ReactNode;
  switch (view) {
    case 'plan':
      body = <AccountingChartScreen extraHeader={extraHeader} />;
      break;
    case 'reprise':
      body = <AccountingBackfillScreen extraHeader={extraHeader} />;
      break;
    case 'fournisseurs':
      body = <AccountingSuppliersScreen extraHeader={extraHeader} />;
      break;
    case 'immos':
      body = <AccountingAssetsScreen extraHeader={extraHeader} />;
      break;
    default:
      body = <AccountingFiscalYearsScreen extraHeader={extraHeader} />;
  }

  return body;
}
