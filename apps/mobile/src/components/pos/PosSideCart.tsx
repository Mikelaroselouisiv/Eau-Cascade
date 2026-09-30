import { Ionicons } from '@expo/vector-icons';
import type { Dispatch, SetStateAction } from 'react';
import { FlatList, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { MoneyText } from '@/components/MoneyText';
import type { SaleDraft } from '@/components/pos/posDraft';
import { BrandColors } from '@/constants/brand';
import { Spacing } from '@/constants/theme';
import type { Product } from '@/types/api';
import { formatMoney } from '@/utils/datetime';
import { effectiveUnitPrice, setCartLineManualPrice, type CartLine } from '@/utils/posCart';

type Props = {
  mode: 'classic' | 'special';
  cart: CartLine[];
  productsById: Map<number, Product>;
  familyQtyMap: Map<number, number>;
  qtyDrafts: Record<number, string>;
  setQtyDrafts: Dispatch<SetStateAction<Record<number, string>>>;
  onUpdateDraft: (next: (d: SaleDraft) => SaleDraft) => void;
  onBumpQty: (productSaleUnitId: number, delta: number) => void;
  onSetQty: (productSaleUnitId: number, qty: number) => void;
};

export function PosSideCart({
  mode,
  cart,
  productsById,
  familyQtyMap,
  qtyDrafts,
  setQtyDrafts,
  onUpdateDraft,
  onBumpQty,
  onSetQty,
}: Props) {
  return (
    <View style={styles.pane}>
      <FlatList
        data={cart}
        keyExtractor={(line) => String(line.productSaleUnitId)}
        style={styles.flex}
        contentContainerStyle={styles.list}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        renderItem={({ item }) => {
          const product = productsById.get(item.productId);
          const price = effectiveUnitPrice(product, item, familyQtyMap);
          return (
            <View style={styles.line}>
              <Text style={styles.lineName} numberOfLines={2}>
                {item.label}
              </Text>
              {mode === 'special' ? (
                <TextInput
                  style={styles.priceInput}
                  keyboardType="decimal-pad"
                  placeholder="Prix"
                  placeholderTextColor={BrandColors.textMuted}
                  value={item.manualUnitPrice != null ? String(item.manualUnitPrice) : ''}
                  onChangeText={(v) =>
                    onUpdateDraft((d) => ({
                      ...d,
                      cart: setCartLineManualPrice(d.cart, item.productSaleUnitId, v),
                    }))
                  }
                />
              ) : (
                <Text style={styles.lineMeta}>{formatMoney(price)}</Text>
              )}
              <View style={styles.lineBottom}>
                <View style={styles.qty}>
                  <Pressable onPress={() => onBumpQty(item.productSaleUnitId, -0.5)} hitSlop={8}>
                    <Ionicons name="remove-circle" size={26} color={BrandColors.primary} />
                  </Pressable>
                  <TextInput
                    style={styles.qtyInput}
                    keyboardType="decimal-pad"
                    value={qtyDrafts[item.productSaleUnitId] ?? String(item.quantity)}
                    onChangeText={(v) =>
                      setQtyDrafts((prev) => ({ ...prev, [item.productSaleUnitId]: v }))
                    }
                    onBlur={() => {
                      const raw = (qtyDrafts[item.productSaleUnitId] ?? '').replace(',', '.');
                      const n = Number(raw);
                      if (Number.isFinite(n)) onSetQty(item.productSaleUnitId, n);
                      setQtyDrafts((prev) => {
                        const next = { ...prev };
                        delete next[item.productSaleUnitId];
                        return next;
                      });
                    }}
                  />
                  <Pressable onPress={() => onBumpQty(item.productSaleUnitId, 0.5)} hitSlop={8}>
                    <Ionicons name="add-circle" size={26} color={BrandColors.primary} />
                  </Pressable>
                </View>
                <MoneyText value={price * item.quantity} style={styles.lineTotal} />
              </View>
            </View>
          );
        }}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Ionicons name="cart-outline" size={28} color={BrandColors.textMuted} />
            <Text style={styles.emptyText}>Vide</Text>
          </View>
        }
      />
    </View>
  );
}

export function PosHomeFields({
  draft,
  onUpdateDraft,
}: {
  draft: SaleDraft;
  onUpdateDraft: (next: (d: SaleDraft) => SaleDraft) => void;
}) {
  const stops = draft.deliveryStops ?? [{ address: '', quantity: '' }];
  return (
    <View style={styles.home}>
      <View style={styles.field}>
        <Ionicons name="call-outline" size={16} color={BrandColors.textMuted} />
        <TextInput
          style={styles.fieldInput}
          placeholder="Téléphone"
          placeholderTextColor={BrandColors.textMuted}
          keyboardType="phone-pad"
          value={draft.clientPhone}
          onChangeText={(v) => onUpdateDraft((d) => ({ ...d, clientPhone: v }))}
        />
      </View>
      {stops.map((stop, idx) => (
        <View key={idx} style={styles.stop}>
          <View style={[styles.field, styles.stopAddr]}>
            <Ionicons name="location-outline" size={16} color={BrandColors.textMuted} />
            <TextInput
              style={styles.fieldInput}
              placeholder="Adresse"
              placeholderTextColor={BrandColors.textMuted}
              value={stop.address}
              onChangeText={(v) =>
                onUpdateDraft((d) => {
                  const rows = [
                    ...(d.deliveryStops?.length
                      ? d.deliveryStops
                      : [{ address: '', quantity: '' }]),
                  ];
                  rows[idx] = { ...rows[idx], address: v };
                  return { ...d, deliveryStops: rows, clientAddress: rows[0]?.address ?? '' };
                })
              }
            />
          </View>
          <View style={styles.stopQty}>
            <TextInput
              style={styles.stopQtyInput}
              placeholder="Qté"
              placeholderTextColor={BrandColors.textMuted}
              keyboardType="decimal-pad"
              value={stop.quantity}
              onChangeText={(v) =>
                onUpdateDraft((d) => {
                  const rows = [
                    ...(d.deliveryStops?.length
                      ? d.deliveryStops
                      : [{ address: '', quantity: '' }]),
                  ];
                  rows[idx] = { ...rows[idx], quantity: v };
                  return { ...d, deliveryStops: rows };
                })
              }
            />
          </View>
          {stops.length > 1 ? (
            <Pressable
              onPress={() =>
                onUpdateDraft((d) => {
                  const rows = (d.deliveryStops ?? []).filter((_, i) => i !== idx);
                  return { ...d, deliveryStops: rows, clientAddress: rows[0]?.address ?? '' };
                })
              }>
              <Ionicons name="close-circle" size={20} color={BrandColors.danger} />
            </Pressable>
          ) : null}
        </View>
      ))}
      <Pressable
        onPress={() =>
          onUpdateDraft((d) => ({
            ...d,
            deliveryStops: [
              ...(d.deliveryStops?.length ? d.deliveryStops : [{ address: '', quantity: '' }]),
              { address: '', quantity: '' },
            ],
          }))
        }>
        <Text style={styles.addStop}>+ Adresse</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  pane: {
    flex: 1,
    minWidth: 0,
    backgroundColor: BrandColors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: BrandColors.border,
    overflow: 'hidden',
  },
  flex: { flex: 1 },
  list: { padding: 8, gap: 8, paddingBottom: 12, flexGrow: 1 },
  empty: { alignItems: 'center', gap: 6, paddingVertical: Spacing.five },
  emptyText: { color: BrandColors.textMuted, fontWeight: '700', fontSize: 13 },
  line: {
    backgroundColor: BrandColors.surfaceSoft,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: BrandColors.border,
    padding: 10,
    gap: 4,
  },
  lineName: { color: BrandColors.text, fontWeight: '800', fontSize: 13 },
  lineMeta: { color: BrandColors.textMuted, fontSize: 11 },
  lineBottom: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  lineTotal: { fontWeight: '800', fontSize: 13, color: BrandColors.text },
  qty: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  qtyInput: {
    minWidth: 40,
    textAlign: 'center',
    fontWeight: '800',
    fontSize: 14,
    borderWidth: 1,
    borderColor: BrandColors.border,
    borderRadius: 8,
    paddingVertical: 4,
    color: BrandColors.text,
  },
  priceInput: {
    borderWidth: 1,
    borderColor: BrandColors.borderStrong,
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 4,
    color: BrandColors.text,
    fontSize: 13,
  },
  home: { gap: 8 },
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: 1,
    borderColor: BrandColors.borderStrong,
    borderRadius: 12,
    paddingHorizontal: 10,
    backgroundColor: BrandColors.surface,
  },
  fieldInput: { flex: 1, paddingVertical: 10, color: BrandColors.text, fontSize: 15 },
  stop: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  stopAddr: { flex: 1 },
  stopQty: {
    width: 58,
    borderWidth: 1,
    borderColor: BrandColors.borderStrong,
    borderRadius: 12,
    backgroundColor: BrandColors.surface,
  },
  stopQtyInput: { paddingVertical: 10, textAlign: 'center', color: BrandColors.text, fontSize: 14 },
  addStop: { color: BrandColors.primary, fontWeight: '800', fontSize: 13, paddingVertical: 2 },
});
