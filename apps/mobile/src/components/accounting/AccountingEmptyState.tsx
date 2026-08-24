import type { ReactNode } from 'react';
import { Text } from 'react-native';

import { accountingStyles as styles } from './accountingStyles';

export function AccountingEmptyState({ children }: { children: ReactNode }) {
  return <Text style={styles.empty}>{children}</Text>;
}
