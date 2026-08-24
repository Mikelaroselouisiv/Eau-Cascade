import { AccountingScopeProvider } from '@/context/AccountingScopeContext';
import { SectionTabsLayout } from '@/components/SectionTabsLayout';
import { SECTION_TABS } from '@/navigation/menu';

export default function AccountingLayout() {
  return (
    <AccountingScopeProvider>
      <SectionTabsLayout
        tabs={SECTION_TABS.accounting}
        hiddenScreens={['overview', 'journal', 'balance', 'bilan', 'resultat']}
      />
    </AccountingScopeProvider>
  );
}
