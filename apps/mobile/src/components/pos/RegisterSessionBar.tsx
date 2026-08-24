import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { ModalShell } from '@/components/ModalShell';
import { BrandColors } from '@/constants/brand';
import { Spacing } from '@/constants/theme';
import {
  closeRegisterSession,
  ensureDefaultRegister,
  getActiveRegisterSession,
  getInventoryCountSheet,
  getRegisterClosingCashPreview,
  listRegisters,
  openRegisterSession,
} from '@/services/api';
import type {
  InventoryCountSheetRow,
  RegisterClosingCashPreview,
  RegisterInventoryLinePayload,
  RegisterListItem,
  RegisterSessionDetail,
} from '@/types/api';
import { formatMoney } from '@/utils/datetime';

type PanelMode = 'open' | 'close' | null;

type Props = {
  companyId?: number;
  departmentId?: number;
  session: RegisterSessionDetail | null;
  onSessionChange: (session: RegisterSessionDetail | null) => void;
  onStatus: (message: string) => void;
};

function parseQty(raw: string): number | null {
  const trimmed = raw.trim().replace(/\s/g, '').replace(',', '.');
  if (trimmed === '') return null;
  const n = Number(trimmed);
  if (!Number.isFinite(n) || n < 0) return null;
  return n;
}

export function RegisterSessionBar({
  companyId,
  departmentId,
  session,
  onSessionChange,
  onStatus,
}: Props) {
  const [panel, setPanel] = useState<PanelMode>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [registers, setRegisters] = useState<RegisterListItem[]>([]);
  const [selectedRegisterId, setSelectedRegisterId] = useState<number | null>(null);
  const [countProducts, setCountProducts] = useState<InventoryCountSheetRow[]>([]);
  const [counts, setCounts] = useState<Record<number, string>>({});
  const [openingCash, setOpeningCash] = useState('');
  const [closingExpected, setClosingExpected] = useState('');
  const [closingCounted, setClosingCounted] = useState('');
  const [closingPreview, setClosingPreview] = useState<RegisterClosingCashPreview | null>(null);

  const refreshSession = useCallback(async () => {
    const active = await getActiveRegisterSession();
    onSessionChange(active);
  }, [onSessionChange]);

  useEffect(() => {
    void refreshSession().catch(() => onSessionChange(null));
  }, [refreshSession, onSessionChange]);

  const linesReady = useMemo(
    () => countProducts.every((p) => parseQty(counts[p.id] ?? '') !== null),
    [countProducts, counts],
  );

  async function openPanel(mode: PanelMode) {
    if (!mode || departmentId == null) {
      onStatus('Département manquant pour la caisse');
      return;
    }
    setError('');
    setBusy(true);
    try {
      let regs = await listRegisters({ companyId, departmentId });
      if (regs.length === 0 && companyId != null) {
        await ensureDefaultRegister(companyId);
        regs = await listRegisters({ companyId, departmentId });
      }
      setRegisters(regs);
      setSelectedRegisterId(regs[0]?.id ?? null);

      const sheet = await getInventoryCountSheet(departmentId);
      setCountProducts(sheet.products);
      setCounts(
        Object.fromEntries(sheet.products.map((p) => [p.id, String(p.stock)])),
      );

      if (mode === 'open') {
        setOpeningCash('');
        setClosingPreview(null);
      } else if (session) {
        const preview = await getRegisterClosingCashPreview(session.id);
        setClosingPreview(preview);
        setClosingExpected(String(preview.expected));
        setClosingCounted(String(preview.expected));
      }
      setPanel(mode);
    } catch {
      onStatus('Impossible de charger la caisse');
    } finally {
      setBusy(false);
    }
  }

  function buildLines(): RegisterInventoryLinePayload[] | null {
    const lines: RegisterInventoryLinePayload[] = [];
    for (const p of countProducts) {
      const qty = parseQty(counts[p.id] ?? '');
      if (qty === null) return null;
      lines.push({ productId: p.id, countedQty: qty });
    }
    return lines;
  }

  async function submitOpen() {
    if (departmentId == null || selectedRegisterId == null) {
      setError('Caisse / département manquant');
      return;
    }
    const lines = buildLines();
    if (!lines) {
      setError('Complétez le comptage stock');
      return;
    }
    const cashRaw = openingCash.trim().replace(',', '.');
    const openingCashAmount =
      cashRaw === '' ? undefined : Number.isFinite(Number(cashRaw)) ? Number(cashRaw) : undefined;
    if (cashRaw !== '' && openingCashAmount === undefined) {
      setError('Fond de caisse invalide');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const next = await openRegisterSession({
        registerId: selectedRegisterId,
        departmentId,
        openingCashAmount,
        lines,
      });
      onSessionChange(next);
      setPanel(null);
      onStatus('Caisse ouverte');
    } catch {
      setError('Ouverture impossible');
    } finally {
      setBusy(false);
    }
  }

  async function submitClose() {
    if (!session) return;
    const lines = buildLines();
    if (!lines) {
      setError('Complétez le comptage stock');
      return;
    }
    const expected = Number(closingExpected.replace(',', '.'));
    const counted = Number(closingCounted.replace(',', '.'));
    if (!Number.isFinite(expected) || expected < 0 || !Number.isFinite(counted) || counted < 0) {
      setError('Montants invalides');
      return;
    }
    setBusy(true);
    setError('');
    try {
      await closeRegisterSession(session.id, {
        closingCashExpected: expected,
        closingCashCounted: counted,
        lines,
      });
      onSessionChange(null);
      setPanel(null);
      onStatus('Caisse fermée');
    } catch {
      setError('Fermeture impossible');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <View style={styles.bar}>
        <View style={styles.barInfo}>
          <Text style={styles.barLabel}>
            {session
              ? `Ouverte · ${session.register.code}`
              : 'Caisse fermée'}
          </Text>
          {session ? (
            <Text style={styles.barMeta}>{session.department.name}</Text>
          ) : (
            <Text style={styles.barMeta}>Ouvrez la caisse pour encaisser</Text>
          )}
        </View>
        {session ? (
          <Pressable
            style={[styles.barBtn, styles.barBtnDanger]}
            onPress={() => void openPanel('close')}
            disabled={busy}>
            <Text style={styles.barBtnTextDanger}>Fermer</Text>
          </Pressable>
        ) : (
          <Pressable
            style={styles.barBtn}
            onPress={() => void openPanel('open')}
            disabled={busy || departmentId == null}>
            {busy && !panel ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.barBtnText}>Ouvrir</Text>
            )}
          </Pressable>
        )}
      </View>

      <ModalShell
        visible={panel != null}
        onRequestClose={() => setPanel(null)}
        body={
          <FlatList
            data={countProducts}
            keyExtractor={(p) => String(p.id)}
            contentContainerStyle={styles.countList}
            ListHeaderComponent={
              <View style={styles.panelHeaderBlock}>
                <Text style={styles.panelTitle}>
                  {panel === 'open' ? 'Ouverture de caisse' : 'Fermeture de caisse'}
                </Text>
                {panel === 'open' ? (
                  <>
                    <Text style={styles.fieldLabel}>Registre</Text>
                    <View style={styles.registerRow}>
                      {registers.map((r) => {
                        const active = r.id === selectedRegisterId;
                        return (
                          <Pressable
                            key={r.id}
                            onPress={() => setSelectedRegisterId(r.id)}
                            style={[styles.registerChip, active && styles.registerChipActive]}>
                            <Text style={[styles.registerChipText, active && styles.registerChipTextActive]}>
                              {r.code}
                            </Text>
                          </Pressable>
                        );
                      })}
                    </View>
                    <Text style={styles.fieldLabel}>Fond d’ouverture (optionnel)</Text>
                    <TextInput
                      style={styles.fieldInput}
                      keyboardType="decimal-pad"
                      value={openingCash}
                      onChangeText={setOpeningCash}
                      placeholder="0.00"
                      placeholderTextColor={BrandColors.textMuted}
                    />
                  </>
                ) : (
                  <>
                    {closingPreview ? (
                      <View style={styles.breakdown}>
                        <View style={styles.breakdownRow}>
                          <Text style={styles.breakdownLabel}>Fond d’ouverture</Text>
                          <Text style={styles.breakdownValue}>
                            {formatMoney(closingPreview.openingCash)}
                          </Text>
                        </View>
                        <View style={styles.breakdownRow}>
                          <Text style={styles.breakdownLabel}>Total ventes (session)</Text>
                          <Text style={styles.breakdownValue}>
                            {formatMoney(closingPreview.salesTotal ?? closingPreview.salesCash)}
                          </Text>
                        </View>
                        <View style={styles.breakdownRow}>
                          <Text style={styles.breakdownLabel}>Dont encaissements espèces</Text>
                          <Text style={styles.breakdownValue}>
                            {formatMoney(closingPreview.salesCash)}
                          </Text>
                        </View>
                        {closingPreview.unsettledChange > 0.009 ? (
                          <View style={styles.breakdownRow}>
                            <Text style={styles.breakdownLabel}>Monnaie non rendue</Text>
                            <Text style={styles.breakdownValue}>
                              {formatMoney(closingPreview.unsettledChange)}
                            </Text>
                          </View>
                        ) : null}
                        {closingPreview.expenses > 0.009 ? (
                          <View style={styles.breakdownRow}>
                            <Text style={styles.breakdownLabel}>Dépenses</Text>
                            <Text style={styles.breakdownValue}>
                              −{formatMoney(closingPreview.expenses)}
                            </Text>
                          </View>
                        ) : null}
                        <View style={[styles.breakdownRow, styles.breakdownExpected]}>
                          <Text style={styles.breakdownLabel}>Espèces attendues</Text>
                          <Text style={styles.breakdownValue}>
                            {formatMoney(closingPreview.expected)}
                          </Text>
                        </View>
                      </View>
                    ) : null}
                    <Text style={styles.fieldLabel}>Espèces attendues</Text>
                    <TextInput
                      style={styles.fieldInput}
                      keyboardType="decimal-pad"
                      value={closingExpected}
                      onChangeText={setClosingExpected}
                    />
                    <Text style={styles.fieldLabel}>Espèces comptées</Text>
                    <TextInput
                      style={styles.fieldInput}
                      keyboardType="decimal-pad"
                      value={closingCounted}
                      onChangeText={setClosingCounted}
                    />
                  </>
                )}
                <Text style={styles.sectionLabel}>Comptage stock</Text>
                {countProducts.length === 0 ? (
                  <Text style={styles.hint}>Aucun produit suivi dans ce département.</Text>
                ) : null}
              </View>
            }
            renderItem={({ item }) => (
              <View style={styles.countRow}>
                <View style={styles.countInfo}>
                  <Text style={styles.countName} numberOfLines={2}>
                    {item.name}
                  </Text>
                  <Text style={styles.countMeta}>
                    Système : {item.stock} {item.unitLabel}
                  </Text>
                </View>
                <TextInput
                  style={styles.countInput}
                  keyboardType="decimal-pad"
                  value={counts[item.id] ?? ''}
                  onChangeText={(v) => setCounts((prev) => ({ ...prev, [item.id]: v }))}
                />
              </View>
            )}
          />
        }
        footer={
          <View style={styles.footer}>
            {error ? <Text style={styles.error}>{error}</Text> : null}
            <Pressable
              style={[styles.submit, (!linesReady || busy) && styles.submitDisabled]}
              disabled={!linesReady || busy}
              onPress={() => void (panel === 'open' ? submitOpen() : submitClose())}>
              {busy ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.submitText}>
                  {panel === 'open' ? 'Confirmer l’ouverture' : 'Confirmer la fermeture'}
                </Text>
              )}
            </Pressable>
          </View>
        }>
        <View style={styles.modalTop}>
          <Text style={styles.modalTopTitle}>Caisse</Text>
          <Pressable onPress={() => setPanel(null)} hitSlop={12}>
            <Text style={styles.modalClose}>Fermer</Text>
          </Pressable>
        </View>
      </ModalShell>
    </>
  );
}

const styles = StyleSheet.create({
  bar: {
    marginHorizontal: Spacing.three,
    marginTop: Spacing.two,
    padding: Spacing.three,
    borderRadius: 12,
    backgroundColor: BrandColors.surface,
    borderWidth: 1,
    borderColor: BrandColors.border,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
  },
  barInfo: { flex: 1, gap: 2 },
  barLabel: { fontSize: 15, fontWeight: '700', color: BrandColors.text },
  barMeta: { fontSize: 13, color: BrandColors.textMuted },
  barBtn: {
    backgroundColor: BrandColors.primary,
    paddingHorizontal: Spacing.three,
    paddingVertical: 10,
    borderRadius: 10,
    minWidth: 88,
    alignItems: 'center',
  },
  barBtnDanger: {
    backgroundColor: BrandColors.primarySoft,
    borderWidth: 1,
    borderColor: BrandColors.danger,
  },
  barBtnText: { color: '#fff', fontWeight: '700' },
  barBtnTextDanger: { color: BrandColors.danger, fontWeight: '700' },
  modalTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.three,
  },
  modalTopTitle: { fontSize: 18, fontWeight: '700', color: BrandColors.text },
  modalClose: { color: BrandColors.primary, fontWeight: '600' },
  countList: { paddingHorizontal: Spacing.three, paddingBottom: Spacing.four, gap: Spacing.two },
  panelHeaderBlock: { gap: Spacing.two, marginBottom: Spacing.three },
  panelTitle: { fontSize: 20, fontWeight: '700', color: BrandColors.text, marginBottom: Spacing.two },
  fieldLabel: { fontSize: 13, fontWeight: '600', color: BrandColors.textMuted, marginTop: Spacing.two },
  fieldInput: {
    borderWidth: 1,
    borderColor: BrandColors.borderStrong,
    borderRadius: 10,
    paddingHorizontal: Spacing.three,
    paddingVertical: 12,
    fontSize: 16,
    color: BrandColors.text,
    backgroundColor: BrandColors.surface,
  },
  registerRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  registerChip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: BrandColors.borderStrong,
  },
  registerChipActive: { backgroundColor: BrandColors.primary, borderColor: BrandColors.primary },
  registerChipText: { color: BrandColors.text, fontWeight: '600' },
  registerChipTextActive: { color: '#fff' },
  sectionLabel: {
    marginTop: Spacing.three,
    fontSize: 15,
    fontWeight: '700',
    color: BrandColors.text,
  },
  hint: { color: BrandColors.textMuted, fontSize: 14 },
  breakdown: {
    borderWidth: 1,
    borderColor: BrandColors.border,
    backgroundColor: BrandColors.surfaceSoft,
    borderRadius: 12,
    padding: Spacing.three,
    gap: 8,
  },
  breakdownRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 8 },
  breakdownExpected: {
    borderTopWidth: 1,
    borderTopColor: BrandColors.border,
    paddingTop: 8,
  },
  breakdownLabel: { color: BrandColors.textMuted, fontSize: 13, flex: 1 },
  breakdownValue: { color: BrandColors.text, fontWeight: '700', fontSize: 13 },
  countRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    backgroundColor: BrandColors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: BrandColors.border,
    padding: Spacing.three,
    marginBottom: Spacing.two,
  },
  countInfo: { flex: 1, gap: 2 },
  countName: { fontWeight: '600', color: BrandColors.text },
  countMeta: { fontSize: 12, color: BrandColors.textMuted },
  countInput: {
    width: 88,
    borderWidth: 1,
    borderColor: BrandColors.borderStrong,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 10,
    textAlign: 'right',
    fontSize: 16,
    color: BrandColors.text,
  },
  footer: { padding: Spacing.three, gap: Spacing.two, backgroundColor: BrandColors.bg },
  error: { color: BrandColors.danger, fontWeight: '600' },
  submit: {
    backgroundColor: BrandColors.primary,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
  },
  submitDisabled: { opacity: 0.5 },
  submitText: { color: '#fff', fontWeight: '700', fontSize: 16 },
});
