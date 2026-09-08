import { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';

import { ModalShell } from '@/components/ModalShell';
import { BrandColors } from '@/constants/brand';
import { Spacing } from '@/constants/theme';
import { createCarrier, getCarrier, listCarriers, updateCarrier } from '@/services/api';
import { formatApiError } from '@/services/api-errors';
import type { CarrierFiche, CarrierRow, Product } from '@/types/api';
import { businessTodayYmd, formatMoney, monthStartYmd, ymdFromIso } from '@/utils/datetime';
import { formatQuantity } from '@/utils/quantity';

type Props = {
  departmentId: number;
  finishedGoods: Product[];
  canManage: boolean;
  styles: Record<string, object>;
  onMessage: (msg: string) => void;
};

export function CarriersPanel({ departmentId, finishedGoods, canManage, styles, onMessage }: Props) {
  const [rows, setRows] = useState<CarrierRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [createError, setCreateError] = useState('');
  const [newName, setNewName] = useState('');
  const [newPhone, setNewPhone] = useState('');
  const [newRates, setNewRates] = useState<Record<number, string>>({});
  const [fiche, setFiche] = useState<CarrierFiche | null>(null);
  const [dateFrom, setDateFrom] = useState(monthStartYmd());
  const [dateTo, setDateTo] = useState(businessTodayYmd());
  const [editName, setEditName] = useState('');
  const [editPhone, setEditPhone] = useState('');
  const [editRates, setEditRates] = useState<Record<number, string>>({});
  const [editError, setEditError] = useState('');

  const reload = useCallback(async () => {
    setRows(await listCarriers(departmentId));
  }, [departmentId]);

  useEffect(() => {
    void reload().catch((e) => onMessage(formatApiError(e, 'Chargement impossible.')));
  }, [departmentId, reload, onMessage]);

  function collectRates(src: Record<number, string>) {
    return finishedGoods
      .map((p) => ({
        productId: p.id,
        coefficient: Number((src[p.id] ?? '').replace(',', '.')),
      }))
      .filter((r) => Number.isFinite(r.coefficient) && r.coefficient >= 0);
  }

  async function onCreate() {
    const name = newName.trim();
    const phone = newPhone.trim();
    if (!name || !phone) {
      setCreateError('Nom et téléphone sont requis.');
      return;
    }
    setBusy(true);
    setCreateError('');
    try {
      await createCarrier({ departmentId, name, phone, rates: collectRates(newRates) });
      setNewName('');
      setNewPhone('');
      setNewRates({});
      setCreateOpen(false);
      await reload();
      onMessage('Transporteur créé.');
    } catch (e) {
      setCreateError(formatApiError(e, 'Création impossible.'));
    } finally {
      setBusy(false);
    }
  }

  async function openFiche(id: number, from = dateFrom, to = dateTo) {
    try {
      const row = await getCarrier(id, { dateFrom: from, dateTo: to });
      const switched = fiche?.id !== row.id;
      setFiche(row);
      if (switched) {
        setEditName(row.name);
        setEditPhone(row.phone);
        const next: Record<number, string> = {};
        for (const r of row.rates) next[r.productId] = String(r.coefficient);
        setEditRates(next);
        setEditError('');
      }
    } catch (e) {
      onMessage(formatApiError(e, 'Fiche impossible.'));
    }
  }

  async function onSaveFiche() {
    if (!fiche || !canManage) return;
    const name = editName.trim();
    const phone = editPhone.trim();
    if (!name || !phone) {
      setEditError('Nom et téléphone sont requis.');
      return;
    }
    setBusy(true);
    setEditError('');
    try {
      await updateCarrier(fiche.id, { name, phone, rates: collectRates(editRates) });
      await reload();
      const row = await getCarrier(fiche.id, { dateFrom, dateTo });
      setFiche(row);
      onMessage('Transporteur enregistré.');
    } catch (e) {
      setEditError(formatApiError(e, 'Enregistrement impossible.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <View>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
        <Text style={styles.cardTitle}>Transporteurs</Text>
        {canManage ? (
          <Pressable
            onPress={() => {
              setCreateError('');
              setNewName('');
              setNewPhone('');
              setNewRates({});
              setCreateOpen(true);
            }}>
            <Text style={{ color: BrandColors.primary, fontWeight: '700' }}>Nouveau</Text>
          </Pressable>
        ) : null}
      </View>
      {rows.length === 0 ? <Text style={styles.meta}>Aucun transporteur</Text> : null}
      {rows.map((w) => (
        <Pressable
          key={w.id}
          onPress={() => void openFiche(w.id)}
          style={{ paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: BrandColors.border }}>
          <Text style={{ color: BrandColors.text, fontWeight: '600' }}>{w.name}</Text>
          <Text style={styles.meta}>
            {w.phone} · {ymdFromIso(w.startedAt)} · {formatQuantity(w.deliveredQty ?? 0)} ·{' '}
            {formatMoney(w.payrollAmount ?? 0)}
          </Text>
        </Pressable>
      ))}

      <ModalShell
        visible={createOpen}
        onRequestClose={() => setCreateOpen(false)}
        body={
          <ScrollView contentContainerStyle={{ padding: Spacing.three, gap: 10 }} keyboardShouldPersistTaps="handled">
            {createError ? <Text style={styles.error}>{createError}</Text> : null}
            <TextInput style={[styles.qtyInput, { width: '100%' }]} placeholder="Nom" value={newName} onChangeText={setNewName} />
            <TextInput
              style={[styles.qtyInput, { width: '100%' }]}
              placeholder="Téléphone"
              keyboardType="phone-pad"
              value={newPhone}
              onChangeText={setNewPhone}
            />
            {finishedGoods.map((p) => (
              <View key={p.id} style={styles.qtyRow}>
                <Text style={styles.qtyName}>{p.name}</Text>
                <TextInput
                  style={styles.qtyInput}
                  keyboardType="decimal-pad"
                  value={newRates[p.id] ?? ''}
                  onChangeText={(v) => setNewRates((prev) => ({ ...prev, [p.id]: v }))}
                />
              </View>
            ))}
          </ScrollView>
        }
        footer={
          <View style={{ padding: Spacing.three }}>
            <Pressable style={[styles.submit, busy && styles.submitDisabled]} disabled={busy} onPress={() => void onCreate()}>
              <Text style={styles.submitText}>Créer</Text>
            </Pressable>
          </View>
        }>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: Spacing.three, paddingVertical: Spacing.two }}>
          <Text style={styles.cardTitle}>Nouveau transporteur</Text>
          <Pressable onPress={() => setCreateOpen(false)} hitSlop={12}>
            <Text style={styles.meta}>Fermer</Text>
          </Pressable>
        </View>
      </ModalShell>

      <ModalShell
        visible={fiche != null}
        onRequestClose={() => setFiche(null)}
        body={
          fiche ? (
            <ScrollView contentContainerStyle={{ padding: Spacing.three, gap: 10 }}>
              {canManage ? (
                <>
                  {editError ? <Text style={styles.error}>{editError}</Text> : null}
                  <TextInput style={[styles.qtyInput, { width: '100%' }]} value={editName} onChangeText={setEditName} />
                  <TextInput
                    style={[styles.qtyInput, { width: '100%' }]}
                    keyboardType="phone-pad"
                    value={editPhone}
                    onChangeText={setEditPhone}
                  />
                  {finishedGoods.map((p) => (
                    <View key={p.id} style={styles.qtyRow}>
                      <Text style={styles.qtyName}>{p.name}</Text>
                      <TextInput
                        style={styles.qtyInput}
                        keyboardType="decimal-pad"
                        value={editRates[p.id] ?? ''}
                        onChangeText={(v) => setEditRates((prev) => ({ ...prev, [p.id]: v }))}
                      />
                    </View>
                  ))}
                  <Pressable style={[styles.submit, busy && styles.submitDisabled]} disabled={busy} onPress={() => void onSaveFiche()}>
                    <Text style={styles.submitText}>Enregistrer</Text>
                  </Pressable>
                </>
              ) : (
                <Text style={styles.meta}>
                  {fiche.phone} · {ymdFromIso(fiche.startedAt)}
                </Text>
              )}
              <Text style={styles.meta}>Du</Text>
              <TextInput
                style={styles.qtyInput}
                value={dateFrom}
                onChangeText={(v) => {
                  setDateFrom(v);
                  void openFiche(fiche.id, v, dateTo);
                }}
              />
              <Text style={styles.meta}>Au</Text>
              <TextInput
                style={styles.qtyInput}
                value={dateTo}
                onChangeText={(v) => {
                  setDateTo(v);
                  void openFiche(fiche.id, dateFrom, v);
                }}
              />
              <Text style={{ color: BrandColors.text }}>
                Livré {formatQuantity(fiche.deliveredQty)} · {formatMoney(fiche.payrollAmount)}
              </Text>
              {fiche.deliveredByProduct.map((r) => (
                <Text key={r.productId} style={styles.meta}>
                  {r.name} · {formatQuantity(r.quantity)} · {formatMoney(r.payrollAmount)}
                </Text>
              ))}
            </ScrollView>
          ) : null
        }>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: Spacing.three, paddingVertical: Spacing.two }}>
          <Text style={styles.cardTitle}>{fiche?.name ?? 'Transporteur'}</Text>
          <Pressable onPress={() => setFiche(null)} hitSlop={12}>
            <Text style={styles.meta}>Fermer</Text>
          </Pressable>
        </View>
      </ModalShell>
    </View>
  );
}
