import { Ionicons } from '@expo/vector-icons';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { ModalShell } from '@/components/ModalShell';
import { MoneyText } from '@/components/MoneyText';
import { BrandColors } from '@/constants/brand';
import { Spacing } from '@/constants/theme';
import type { SaleCashGapRow, SaleCashGaps } from '@/types/api';
import { saleDisplayRef } from '@/utils/saleRef';

type Props = {
  visible: boolean;
  salesEnabled: boolean;
  query: string;
  onQueryChange: (value: string) => void;
  cashGaps: SaleCashGaps;
  filtered: SaleCashGaps;
  busyId: number | null;
  onSettleChange: (row: SaleCashGapRow) => void;
  onCollectBalance: (row: SaleCashGapRow) => void;
  onClose: () => void;
};

export function PosCashGapsSheet({
  visible,
  salesEnabled,
  query,
  onQueryChange,
  cashGaps,
  filtered,
  busyId,
  onSettleChange,
  onCollectBalance,
  onClose,
}: Props) {
  return (
    <ModalShell
      visible={visible}
      onRequestClose={onClose}
      body={
        <ScrollView
          contentContainerStyle={styles.body}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag">
          <TextInput
            style={styles.search}
            placeholder="N° fiche ou client"
            placeholderTextColor={BrandColors.textMuted}
            value={query}
            onChangeText={onQueryChange}
            autoCorrect={false}
            clearButtonMode="while-editing"
          />
          <Text style={styles.section}>Monnaie à rendre</Text>
          {cashGaps.changeOwed.length === 0 ? (
            <Text style={styles.empty}>Aucune</Text>
          ) : filtered.changeOwed.length === 0 ? (
            <Text style={styles.empty}>Aucun résultat</Text>
          ) : (
            filtered.changeOwed.map((row) => (
              <GapRow
                key={`c-${row.id}`}
                row={row}
                kind="change"
                busy={busyId === row.id}
                disabled={!salesEnabled}
                onPress={() => onSettleChange(row)}
              />
            ))
          )}
          <Text style={styles.section}>Restes à encaisser</Text>
          {cashGaps.balanceOwed.length === 0 ? (
            <Text style={styles.empty}>Aucun</Text>
          ) : filtered.balanceOwed.length === 0 ? (
            <Text style={styles.empty}>Aucun résultat</Text>
          ) : (
            filtered.balanceOwed.map((row) => (
              <GapRow
                key={`b-${row.id}`}
                row={row}
                kind="balance"
                busy={busyId === row.id}
                disabled={!salesEnabled}
                onPress={() => onCollectBalance(row)}
              />
            ))
          )}
        </ScrollView>
      }
      footer={
        <View style={styles.footer}>
          <Pressable style={styles.closeBtn} onPress={onClose}>
            <Text style={styles.closeBtnText}>Fermer</Text>
          </Pressable>
        </View>
      }>
      <View style={styles.header}>
        <Text style={styles.title}>Monnaie</Text>
        <Pressable onPress={onClose} hitSlop={12}>
          <Ionicons name="close" size={26} color={BrandColors.text} />
        </Pressable>
      </View>
    </ModalShell>
  );
}

function GapRow({
  row,
  kind,
  busy,
  disabled,
  onPress,
}: {
  row: SaleCashGapRow;
  kind: 'change' | 'balance';
  busy: boolean;
  disabled: boolean;
  onPress: () => void;
}) {
  return (
    <View style={styles.row}>
      <View style={styles.rowInfo}>
        <Text style={styles.rowTitle}>
          #{saleDisplayRef(row)} · {row.clientName?.trim() || 'Client'}
        </Text>
        <MoneyText value={kind === 'change' ? row.changeDue : row.balanceDue} style={styles.rowAmt} />
      </View>
      <Pressable
        style={[styles.action, kind === 'balance' && styles.actionPrimary, (disabled || busy) && styles.disabled]}
        disabled={disabled || busy}
        onPress={onPress}>
        {busy ? (
          <ActivityIndicator color={kind === 'balance' ? '#fff' : BrandColors.primary} size="small" />
        ) : (
          <Text style={[styles.actionText, kind === 'balance' && styles.actionTextPrimary]}>
            {kind === 'change' ? 'Remettre' : 'Encaisser'}
          </Text>
        )}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.three,
    borderBottomWidth: 1,
    borderBottomColor: BrandColors.border,
  },
  title: { color: BrandColors.text, fontSize: 20, fontWeight: '800' },
  body: { padding: Spacing.four, gap: Spacing.two, paddingBottom: Spacing.five },
  search: {
    borderWidth: 1,
    borderColor: BrandColors.borderStrong,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    color: BrandColors.text,
    backgroundColor: BrandColors.surface,
  },
  section: { color: BrandColors.text, fontSize: 15, fontWeight: '800', marginTop: Spacing.two },
  empty: { color: BrandColors.textMuted, fontSize: 13 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 8 },
  rowInfo: { flex: 1, gap: 2 },
  rowTitle: { fontWeight: '600', color: BrandColors.text },
  rowAmt: { fontWeight: '800', color: BrandColors.primary },
  action: {
    borderWidth: 1,
    borderColor: BrandColors.borderStrong,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    minWidth: 96,
    alignItems: 'center',
    backgroundColor: BrandColors.surface,
  },
  actionPrimary: { backgroundColor: BrandColors.primary, borderColor: BrandColors.primary },
  actionText: { fontWeight: '800', color: BrandColors.text, fontSize: 13 },
  actionTextPrimary: { color: '#fff' },
  disabled: { opacity: 0.5 },
  footer: { padding: Spacing.three, backgroundColor: BrandColors.bg },
  closeBtn: {
    backgroundColor: BrandColors.primary,
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
  },
  closeBtnText: { color: '#fff', fontWeight: '800' },
});
