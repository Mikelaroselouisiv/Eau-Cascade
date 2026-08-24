import { useMemo, useState } from 'react';
import { FlatList, Pressable, Text, TextInput, View } from 'react-native';

import { ModalShell } from '@/components/ModalShell';
import { BrandColors } from '@/constants/brand';
import { Spacing } from '@/constants/theme';
import type { AccountRow } from '@/types/api';

import { accountingStyles as styles } from './accountingStyles';

export function AccountPickerModal({
  visible,
  accounts,
  onClose,
  onSelect,
}: {
  visible: boolean;
  accounts: AccountRow[];
  onClose: () => void;
  onSelect: (account: AccountRow) => void;
}) {
  const [query, setQuery] = useState('');
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = accounts.filter((a) => a.isActive);
    if (!q) return list;
    return list.filter(
      (a) =>
        a.code.toLowerCase().includes(q) ||
        a.name.toLowerCase().includes(q) ||
        (a.systemKey ?? '').toLowerCase().includes(q),
    );
  }, [accounts, query]);

  return (
    <ModalShell
      visible={visible}
      onRequestClose={onClose}
      body={
        <FlatList
          data={filtered}
          keyExtractor={(item) => String(item.id)}
          keyboardShouldPersistTaps="handled"
          ListEmptyComponent={
            <Text style={styles.empty}>Aucun compte ne correspond à la recherche.</Text>
          }
          renderItem={({ item, index }) => (
            <Pressable
              onPress={() => {
                onSelect(item);
                setQuery('');
                onClose();
              }}
              style={[styles.denseRow, index % 2 === 1 && styles.denseRowAlt]}>
              <Text style={styles.colCode}>{item.code}</Text>
              <Text style={styles.colName}>{item.name}</Text>
            </Pressable>
          )}
        />
      }>
      <View style={{ paddingHorizontal: Spacing.three, paddingBottom: Spacing.two, gap: 8 }}>
        <View style={styles.row}>
          <Text style={styles.cardTitle}>Choisir un compte</Text>
          <Pressable onPress={onClose}>
            <Text style={styles.meta}>Fermer</Text>
          </Pressable>
        </View>
        <TextInput
          style={styles.input}
          value={query}
          onChangeText={setQuery}
          placeholder="Code ou nom…"
          placeholderTextColor={BrandColors.textMuted}
          autoCorrect={false}
          autoCapitalize="none"
        />
      </View>
    </ModalShell>
  );
}
