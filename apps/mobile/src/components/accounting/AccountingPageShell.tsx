import type { ReactNode } from 'react';
import { Text, View } from 'react-native';

import { Screen } from '@/components/Screen';
import { useAccountingScope } from '@/context/AccountingScopeContext';

import { accountingStyles as styles } from './accountingStyles';
import { FiscalYearBar } from './FiscalYearBar';

type Props = {
  children: ReactNode;
  extraHeader?: ReactNode;
  showDates?: boolean;
  keyboard?: boolean;
};

export function AccountingBlocked({ message }: { message: string }) {
  return (
    <Screen>
      <View style={styles.blocked}>
        <Text style={styles.blockedText}>{message}</Text>
      </View>
    </Screen>
  );
}

export function AccountingPageShell({
  children,
  extraHeader,
  showDates = false,
  keyboard = false,
}: Props) {
  const { canView, ready, companyId, overviewError } = useAccountingScope();

  if (!canView) {
    return (
      <AccountingBlocked message="Comptabilité réservée aux comptes accounting.view." />
    );
  }

  if (ready && companyId == null) {
    return <AccountingBlocked message="Aucune entreprise disponible." />;
  }

  return (
    <Screen keyboard={keyboard}>
      <View style={{ flex: 1 }}>
        <View style={{ flexGrow: 0, flexShrink: 0 }}>
          <FiscalYearBar showDates={showDates} />
          {extraHeader}
        </View>
        {overviewError ? (
          <Text style={[styles.error, { paddingHorizontal: 16, paddingTop: 8 }]}>
            {overviewError}
          </Text>
        ) : null}
        <View style={{ flex: 1 }}>{children}</View>
      </View>
    </Screen>
  );
}
