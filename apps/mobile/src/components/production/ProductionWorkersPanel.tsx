import { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';

import { ModalShell } from '@/components/ModalShell';
import { BrandColors } from '@/constants/brand';
import { Spacing } from '@/constants/theme';
import {
  createProductionWorker,
  declareProductionWorkerIssue,
  declareProductionWorkerOutput,
  getProductionWorker,
  listProductionWorkerIssues,
  listProductionWorkerOutputs,
  listProductionWorkers,
  updateProductionWorker,
} from '@/services/api';
import { formatApiError } from '@/services/api-errors';
import type { Product, ProductionWorkerFiche, ProductionWorkerOutputRow, ProductionWorkerRow } from '@/types/api';
import { businessTodayYmd, formatDateTimeShort, formatMoney, monthStartYmd, ymdFromIso } from '@/utils/datetime';
import { formatQuantity } from '@/utils/quantity';

type Props = {
  departmentId: number;
  productionEnabled: boolean;
  finishedGoods: Product[];
  rawMaterials: Product[];
  canManageWorkers: boolean;
  styles: Record<string, object>;
  onRefuseClosed: () => void;
  onMessage: (msg: string) => void;
};

export function ProductionWorkersPanel({
  departmentId,
  productionEnabled,
  finishedGoods,
  rawMaterials,
  canManageWorkers,
  styles,
  onRefuseClosed,
  onMessage,
}: Props) {
  const [workers, setWorkers] = useState<ProductionWorkerRow[]>([]);
  const [issues, setIssues] = useState<ProductionWorkerOutputRow[]>([]);
  const [outputs, setOutputs] = useState<ProductionWorkerOutputRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [op, setOp] = useState<'issue' | 'return'>('issue');
  const [createOpen, setCreateOpen] = useState(false);
  const [createError, setCreateError] = useState('');
  const [newName, setNewName] = useState('');
  const [newPhone, setNewPhone] = useState('');
  const [newCoef, setNewCoef] = useState('');
  const [workerId, setWorkerId] = useState<number | ''>('');
  const [qty, setQty] = useState<Record<number, string>>({});
  const [fiche, setFiche] = useState<ProductionWorkerFiche | null>(null);
  const [dateFrom, setDateFrom] = useState(monthStartYmd());
  const [dateTo, setDateTo] = useState(businessTodayYmd());
  const [editName, setEditName] = useState('');
  const [editPhone, setEditPhone] = useState('');
  const [editCoef, setEditCoef] = useState('');
  const [editError, setEditError] = useState('');
  const catalog = op === 'issue' ? rawMaterials : finishedGoods;

  const reload = useCallback(async () => {
    const [w, i, o] = await Promise.all([
      listProductionWorkers(departmentId),
      listProductionWorkerIssues({ departmentId }),
      listProductionWorkerOutputs({ departmentId }),
    ]);
    setWorkers(w);
    setIssues(i);
    setOutputs(o);
    setWorkerId((prev) => (prev !== '' && w.some((row) => row.id === prev) ? prev : (w[0]?.id ?? '')));
  }, [departmentId]);

  useEffect(() => {
    setError('');
    setQty({});
    void reload().catch((e) => onMessage(formatApiError(e, 'Chargement impossible.')));
  }, [departmentId, reload, onMessage]);

  async function onCreate() {
    const name = newName.trim();
    const phone = newPhone.trim();
    const coef = Number(newCoef.replace(',', '.'));
    if (!name || !phone || !Number.isFinite(coef) || coef <= 0) {
      setCreateError('Nom, téléphone et coefficient sont requis.');
      return;
    }
    setBusy(true);
    setCreateError('');
    try {
      await createProductionWorker({ departmentId, name, phone, payrollCoefficient: coef });
      setNewName('');
      setNewPhone('');
      setNewCoef('');
      setCreateOpen(false);
      await reload();
      onMessage('Ouvrier créé.');
    } catch (e) {
      setCreateError(formatApiError(e, 'Création impossible.'));
    } finally {
      setBusy(false);
    }
  }

  async function onRecord() {
    if (!productionEnabled) {
      onRefuseClosed();
      return;
    }
    if (workerId === '') {
      setError('Ouvrier requis.');
      return;
    }
    const items = catalog
      .map((p) => ({
        productId: p.id,
        quantity: Number((qty[p.id] ?? '').replace(',', '.')),
      }))
      .filter((i) => Number.isFinite(i.quantity) && i.quantity > 0);
    if (items.length === 0) {
      setError('Quantité requise.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      if (op === 'issue') {
        await declareProductionWorkerIssue({ workerId, departmentId, items });
      } else {
        await declareProductionWorkerOutput({ workerId, departmentId, items });
      }
      setQty({});
      await reload();
      onMessage('Enregistré.');
    } catch (e) {
      setError(formatApiError(e, 'Enregistrement impossible.'));
    } finally {
      setBusy(false);
    }
  }

  async function openFiche(id: number, from = dateFrom, to = dateTo) {
    try {
      const row = await getProductionWorker(id, { dateFrom: from, dateTo: to });
      const switched = fiche?.id !== row.id;
      setFiche(row);
      if (switched) {
        setEditName(row.name);
        setEditPhone(row.phone);
        setEditCoef(String(row.payrollCoefficient));
        setEditError('');
      }
    } catch (e) {
      onMessage(formatApiError(e, 'Fiche impossible.'));
    }
  }

  async function onSaveFiche() {
    if (!fiche || !canManageWorkers) return;
    const name = editName.trim();
    const phone = editPhone.trim();
    const coef = Number(editCoef.replace(',', '.'));
    if (!name || !phone || !Number.isFinite(coef) || coef <= 0) {
      setEditError('Nom, téléphone et coefficient sont requis.');
      return;
    }
    setBusy(true);
    setEditError('');
    try {
      await updateProductionWorker(fiche.id, { name, phone, payrollCoefficient: coef });
      await reload();
      const row = await getProductionWorker(fiche.id, { dateFrom, dateTo });
      setFiche(row);
      setEditName(row.name);
      setEditPhone(row.phone);
      setEditCoef(String(row.payrollCoefficient));
      onMessage('Ouvrier enregistré.');
    } catch (e) {
      setEditError(formatApiError(e, 'Enregistrement impossible.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <View>
      {error ? <Text style={styles.error}>{error}</Text> : null}

      <View
        style={{
          flexDirection: 'row',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 10,
        }}>
        <Text style={styles.cardTitle}>Ouvriers</Text>
        {canManageWorkers ? (
          <Pressable
            onPress={() => {
              setCreateError('');
              setNewName('');
              setNewPhone('');
              setNewCoef('');
              setCreateOpen(true);
            }}>
            <Text style={{ color: BrandColors.primary, fontWeight: '700' }}>Nouvel ouvrier</Text>
          </Pressable>
        ) : null}
      </View>
      {workers.length === 0 ? <Text style={styles.meta}>Aucun ouvrier</Text> : null}
      {workers.map((w) => {
        const row = (
          <>
            <Text style={{ color: BrandColors.text, fontWeight: '600' }}>{w.name}</Text>
            <Text style={styles.meta}>
              {canManageWorkers
                ? `${w.phone} · ${ymdFromIso(w.startedAt)} · ${formatMoney(w.payrollCoefficient)} · MP ${formatQuantity(w.sessionIssuedQty ?? 0)} · PF ${formatQuantity(w.sessionQuantity ?? 0)}`
                : w.phone}
            </Text>
          </>
        );
        return canManageWorkers ? (
          <Pressable
            key={w.id}
            onPress={() => void openFiche(w.id)}
            style={{
              paddingVertical: 10,
              borderBottomWidth: 1,
              borderBottomColor: BrandColors.border,
            }}>
            {row}
          </Pressable>
        ) : (
          <View
            key={w.id}
            style={{
              paddingVertical: 10,
              borderBottomWidth: 1,
              borderBottomColor: BrandColors.border,
            }}>
            {row}
          </View>
        );
      })}

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: Spacing.three, marginBottom: 10 }}>
        <Pressable onPress={() => { setOp('issue'); setQty({}); }} style={[styles.chip, op === 'issue' && styles.chipActive]}>
          <Text style={[styles.chipText, op === 'issue' && styles.chipTextActive]}>Matière première</Text>
        </Pressable>
        <Pressable onPress={() => { setOp('return'); setQty({}); }} style={[styles.chip, op === 'return' && styles.chipActive]}>
          <Text style={[styles.chipText, op === 'return' && styles.chipTextActive]}>Produit fini</Text>
        </Pressable>
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 10 }}>
        {workers.map((w) => (
          <Pressable
            key={w.id}
            onPress={() => setWorkerId(w.id)}
            style={[styles.chip, workerId === w.id && styles.chipActive]}>
            <Text style={[styles.chipText, workerId === w.id && styles.chipTextActive]}>{w.name}</Text>
          </Pressable>
        ))}
      </View>
      {catalog.map((p) => (
        <View key={p.id} style={styles.qtyRow}>
          <Text style={styles.qtyName}>{p.name}</Text>
          <TextInput
            style={styles.qtyInput}
            keyboardType="decimal-pad"
            value={qty[p.id] ?? ''}
            onChangeText={(v) => setQty((prev) => ({ ...prev, [p.id]: v }))}
          />
        </View>
      ))}
      <Pressable
        style={[styles.submit, busy && styles.submitDisabled]}
        disabled={busy || workerId === ''}
        onPress={() => void onRecord()}>
        <Text style={styles.submitText}>Enregistrer</Text>
      </Pressable>

      {issues.map((o) => (
        <Text key={`i-${o.id}`} style={[styles.meta, { marginTop: 6 }]}>
          MP · {formatDateTimeShort(o.createdAt)} · {o.worker.name} · {o.product.name} ·{' '}
          {formatQuantity(o.quantity)}
        </Text>
      ))}
      {outputs.map((o) => (
        <Text key={`o-${o.id}`} style={[styles.meta, { marginTop: 6 }]}>
          PF · {formatDateTimeShort(o.createdAt)} · {o.worker.name} · {o.product.name} ·{' '}
          {formatQuantity(o.quantity)}
          {canManageWorkers ? ` · ${formatMoney(o.payrollAmount ?? 0)}` : ''}
        </Text>
      ))}

      <ModalShell
        visible={createOpen}
        onRequestClose={() => setCreateOpen(false)}
        body={
          <ScrollView contentContainerStyle={{ padding: Spacing.three, gap: 10 }} keyboardShouldPersistTaps="handled">
            {createError ? <Text style={styles.error}>{createError}</Text> : null}
            <TextInput
              style={[styles.qtyInput, { width: '100%' }]}
              placeholder="Nom"
              value={newName}
              onChangeText={setNewName}
            />
            <TextInput
              style={[styles.qtyInput, { width: '100%', marginTop: 8 }]}
              placeholder="Téléphone"
              keyboardType="phone-pad"
              value={newPhone}
              onChangeText={setNewPhone}
            />
            <TextInput
              style={[styles.qtyInput, { width: '100%', marginTop: 8 }]}
              placeholder="Coefficient (HTG)"
              keyboardType="decimal-pad"
              value={newCoef}
              onChangeText={setNewCoef}
            />
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
          <Text style={styles.cardTitle}>Nouvel ouvrier</Text>
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
              {canManageWorkers ? (
                <>
                  {editError ? <Text style={styles.error}>{editError}</Text> : null}
                  <TextInput
                    style={[styles.qtyInput, { width: '100%' }]}
                    placeholder="Nom"
                    value={editName}
                    onChangeText={setEditName}
                  />
                  <TextInput
                    style={[styles.qtyInput, { width: '100%' }]}
                    placeholder="Téléphone"
                    keyboardType="phone-pad"
                    value={editPhone}
                    onChangeText={setEditPhone}
                  />
                  <TextInput
                    style={[styles.qtyInput, { width: '100%' }]}
                    placeholder="Coefficient (HTG)"
                    keyboardType="decimal-pad"
                    value={editCoef}
                    onChangeText={setEditCoef}
                  />
                  <Text style={styles.meta}>{ymdFromIso(fiche.startedAt)}</Text>
                  <Pressable
                    style={[styles.submit, busy && styles.submitDisabled]}
                    disabled={busy}
                    onPress={() => void onSaveFiche()}>
                    <Text style={styles.submitText}>Enregistrer</Text>
                  </Pressable>
                </>
              ) : (
                <>
                  <Text style={styles.meta}>{fiche.phone}</Text>
                  <Text style={styles.meta}>
                    {ymdFromIso(fiche.startedAt)} · {formatMoney(fiche.payrollCoefficient)}
                  </Text>
                </>
              )}
              <TextInput
                style={styles.qtyInput}
                value={dateFrom}
                onChangeText={(v) => {
                  setDateFrom(v);
                  void openFiche(fiche.id, v, dateTo);
                }}
              />
              <TextInput
                style={styles.qtyInput}
                value={dateTo}
                onChangeText={(v) => {
                  setDateTo(v);
                  void openFiche(fiche.id, dateFrom, v);
                }}
              />
              <Text style={{ color: BrandColors.text }}>
                MP {formatQuantity(fiche.issuedQty)} · PF {formatQuantity(fiche.finishedQty)} ·{' '}
                {formatMoney(fiche.payrollAmount)}
              </Text>
              {fiche.issuedByProduct.map((r) => (
                <Text key={`mp-${r.productId}`} style={styles.meta}>
                  MP · {r.name} · {formatQuantity(r.quantity)}
                </Text>
              ))}
              {fiche.finishedByProduct.map((r) => (
                <Text key={`pf-${r.productId}`} style={styles.meta}>
                  PF · {r.name} · {formatQuantity(r.quantity)}
                </Text>
              ))}
            </ScrollView>
          ) : null
        }>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: Spacing.three, paddingVertical: Spacing.two }}>
          <Text style={styles.cardTitle}>{fiche?.name ?? 'Ouvrier'}</Text>
          <Pressable onPress={() => setFiche(null)} hitSlop={12}>
            <Text style={styles.meta}>Fermer</Text>
          </Pressable>
        </View>
      </ModalShell>
    </View>
  );
}
