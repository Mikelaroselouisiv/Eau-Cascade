import { useCallback, useMemo, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { MoneyText } from '@/components/MoneyText';
import { KpiCard } from '@/components/monitor/KpiCard';
import { ModalShell } from '@/components/ModalShell';
import { Screen } from '@/components/Screen';
import { BrandColors } from '@/constants/brand';
import { Spacing } from '@/constants/theme';
import { useAuth } from '@/context/AuthContext';
import { useCompanyScope } from '@/hooks/useCompanyScope';
import {
  createCreditSale,
  getCreditCustomer,
  getCreditSummary,
  getProducts,
  listBanks,
  listCreditCustomers,
  recordCreditPayment,
} from '@/services/api';
import type {
  BankRow,
  CreditCustomerDetail,
  CreditCustomerListItem,
  CreditCustomerStatus,
  CreditSummary,
  Product,
} from '@/types/api';
import { formatDateTime, formatMoney } from '@/utils/datetime';
import { saleDisplayRef } from '@/utils/saleRef';
import {
  addLineToCart,
  effectiveUnitPrice,
  familyQtyByProduct,
  setCartLineQty,
  type CartLine,
} from '@/utils/posCart';

const STATUS_LABEL: Record<CreditCustomerStatus, string> = {
  CLEAR: 'À jour',
  PARTIAL: 'En dette',
  OVERDUE: 'Retard',
  AT_LIMIT: 'Plafond',
  BLOCKED: 'Bloqué',
};

const STATUS_COLOR: Record<CreditCustomerStatus, string> = {
  CLEAR: BrandColors.ok,
  PARTIAL: BrandColors.primaryHover,
  OVERDUE: BrandColors.danger,
  AT_LIMIT: '#B45309',
  BLOCKED: '#78716C',
};

export type CreditListMode = 'all' | 'PARTIAL' | 'OVERDUE';

type Props = {
  mode: CreditListMode;
};

function matchesMode(c: CreditCustomerListItem, mode: CreditListMode): boolean {
  if (mode === 'all') return true;
  if (mode === 'PARTIAL') return c.status === 'PARTIAL';
  return c.status === 'OVERDUE' || c.status === 'AT_LIMIT';
}

export function CreditCustomersScreen({ mode }: Props) {
  const { can, canPerm } = useAuth();
  const { companyId, ready } = useCompanyScope();
  const allowed = can(['ADMIN', 'MANAGER']) || canPerm('credit.view');
  const canManage = canPerm('credit.manage') || can(['ADMIN', 'MANAGER']);

  const [q, setQ] = useState('');
  const [query, setQuery] = useState('');
  const [summary, setSummary] = useState<CreditSummary | null>(null);
  const [customers, setCustomers] = useState<CreditCustomerListItem[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [detail, setDetail] = useState<CreditCustomerDetail | null>(null);
  const [payAmount, setPayAmount] = useState('');
  const [payMethod, setPayMethod] = useState<'CASH' | 'CARD' | 'MOBILE_MONEY' | 'BANK'>('CASH');
  const [payBankId, setPayBankId] = useState<number | ''>('');
  const [payBankAccountId, setPayBankAccountId] = useState<number | ''>('');
  const [banks, setBanks] = useState<BankRow[]>([]);
  const [paySaleId, setPaySaleId] = useState<number | null>(null);
  const [payNote, setPayNote] = useState('');
  const [paying, setPaying] = useState(false);
  const [payStatus, setPayStatus] = useState<string | null>(null);
  const [saleVisible, setSaleVisible] = useState(false);
  const [products, setProducts] = useState<Product[]>([]);
  const [productQuery, setProductQuery] = useState('');
  const [cart, setCart] = useState<CartLine[]>([]);
  const [saleQtyDrafts, setSaleQtyDrafts] = useState<Record<number, string>>({});
  const [downPayment, setDownPayment] = useState('');
  const [saleNote, setSaleNote] = useState('');
  const [saleBusy, setSaleBusy] = useState(false);
  const [saleStatus, setSaleStatus] = useState<string | null>(null);

  const filtered = useMemo(
    () => customers.filter((c) => matchesMode(c, mode)),
    [customers, mode],
  );

  const productsById = useMemo(() => {
    const byId = new Map<number, Product>();
    for (const product of products) byId.set(product.id, product);
    return byId;
  }, [products]);

  const familyQtyMap = useMemo(
    () => familyQtyByProduct(cart, productsById),
    [cart, productsById],
  );

  const cartTotal = useMemo(
    () =>
      Math.round(
        cart.reduce(
          (sum, line) =>
            sum +
            effectiveUnitPrice(productsById.get(line.productId), line, familyQtyMap) *
              line.quantity,
          0,
        ) * 100,
      ) / 100,
    [cart, productsById, familyQtyMap],
  );

  const filteredProducts = useMemo(() => {
    const query = productQuery.trim().toLocaleLowerCase('fr');
    return products.filter(
      (product) =>
        product.saleUnits.length > 0 &&
        (!query ||
          product.name.toLocaleLowerCase('fr').includes(query) ||
          (product.sku ?? '').toLocaleLowerCase('fr').includes(query)),
    );
  }, [products, productQuery]);

  const load = useCallback(async () => {
    if (!allowed || companyId == null) return;
    try {
      setError(null);
      const [sum, list] = await Promise.all([
        getCreditSummary(companyId),
        listCreditCustomers({ companyId, q: query || undefined }),
      ]);
      setSummary(sum);
      setCustomers(list);
      try {
        setBanks((await listBanks({ companyId })).filter((b) => b.isActive));
      } catch {
        setBanks([]);
      }
    } catch {
      setSummary(null);
      setCustomers([]);
      setError('Impossible de charger le crédit');
    }
  }, [allowed, companyId, query]);

  useFocusEffect(
    useCallback(() => {
      if (!ready) return;
      void load();
    }, [load, ready]),
  );

  async function onRefresh() {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }

  async function openDetail(row: CreditCustomerListItem) {
    setPayStatus(null);
    setPayAmount('');
    setPayNote('');
    setPaySaleId(null);
    setPayMethod('CASH');
    setPayBankId('');
    setPayBankAccountId('');
    try {
      setDetail(await getCreditCustomer(row.id));
    } catch {
      setError('Impossible d’ouvrir la fiche');
    }
  }

  async function refreshDetail(id: number) {
    const next = await getCreditCustomer(id);
    setDetail(next);
    await load();
  }

  async function submitPayment() {
    if (!detail) return;
    const amount = Number(payAmount.replace(',', '.'));
    if (!Number.isFinite(amount) || amount < 0.01) {
      setPayStatus('Montant invalide');
      return;
    }
    if (payMethod === 'BANK' && (payBankId === '' || payBankAccountId === '')) {
      setPayStatus('Choisissez la banque et le compte');
      return;
    }
    const methodSnapshot = payMethod;
    setPaying(true);
    setPayStatus(null);
    try {
      const res = await recordCreditPayment({
        creditCustomerId: detail.id,
        amount,
        method: methodSnapshot,
        saleId: paySaleId ?? undefined,
        note: payNote.trim() || undefined,
        ...(methodSnapshot === 'BANK' && typeof payBankAccountId === 'number'
          ? { bankAccountId: payBankAccountId }
          : {}),
      });
      setPayAmount('');
      setPayNote('');
      setPaySaleId(null);
      setPayMethod('CASH');
      setPayBankId('');
      setPayBankAccountId('');
      setPayStatus(
        `Encaissement ${formatMoney(res.applied)} enregistré${
          methodSnapshot === 'BANK' ? ' (banque + finance entreprise)' : ' (finance entreprise)'
        }${res.unused > 0.009 ? ` — surplus non affecté ${formatMoney(res.unused)}` : ''}`,
      );
      await refreshDetail(detail.id);
    } catch {
      setPayStatus('Échec encaissement');
    } finally {
      setPaying(false);
    }
  }

  async function openCreditSale() {
    if (!detail) return;
    setCart([]);
    setSaleQtyDrafts({});
    setDownPayment('');
    setSaleNote('');
    setProductQuery('');
    setSaleStatus(null);
    setSaleVisible(true);
    try {
      setProducts(await getProducts(detail.departmentId ?? undefined));
    } catch {
      setProducts([]);
      setSaleStatus('Impossible de charger les produits');
    }
  }

  function addCreditProduct(product: Product) {
    const result = addLineToCart(cart, product);
    if (result.error) {
      setSaleStatus(result.error);
      return;
    }
    setCart(result.cart);
  }

  async function submitCreditSale() {
    if (!detail || cart.length === 0 || saleBusy) return;
    const rawDown = downPayment.trim().replace(',', '.');
    const down = rawDown ? Number(rawDown) : 0;
    if (!Number.isFinite(down) || down < 0 || down > cartTotal) {
      setSaleStatus('Acompte invalide');
      return;
    }
    setSaleBusy(true);
    setSaleStatus(null);
    try {
      const result = await createCreditSale({
        creditCustomerId: detail.id,
        items: cart.map((line) => ({
          productSaleUnitId: line.productSaleUnitId,
          quantity: line.quantity,
        })),
        downPayment: down > 0.009 ? down : undefined,
        downPaymentMethod: 'CASH',
        note: saleNote.trim() || undefined,
      });
      setSaleVisible(false);
      setPayStatus(
        `Vente #${result.txnNumber ?? result.saleId} — total ${formatMoney(result.total)}, reste ${formatMoney(result.balanceDue)}`,
      );
      await refreshDetail(detail.id);
    } catch {
      setSaleStatus('Échec de la vente à crédit');
    } finally {
      setSaleBusy(false);
    }
  }

  if (!allowed) {
    return (
      <Screen>
        <View style={styles.blocked}>
          <Text style={styles.blockedText}>Crédit réservé aux administrateurs et gestionnaires.</Text>
        </View>
      </Screen>
    );
  }

  if (ready && companyId == null) {
    return (
      <Screen>
        <View style={styles.blocked}>
          <Text style={styles.blockedText}>Aucune entreprise disponible pour le crédit.</Text>
        </View>
      </Screen>
    );
  }

  if (companyId == null) {
    return (
      <Screen>
        <View style={styles.blocked}>
          <ActivityIndicator color={BrandColors.accent} />
        </View>
      </Screen>
    );
  }

  const openSales = (detail?.sales ?? []).filter((s) => s.balanceDue > 0.009);

  return (
    <Screen keyboard={detail != null}>
      <View style={styles.searchRow}>
        <TextInput
          style={styles.search}
          placeholder="Rechercher un client…"
          placeholderTextColor={BrandColors.textMuted}
          value={q}
          onChangeText={setQ}
          returnKeyType="search"
          onSubmitEditing={() => setQuery(q.trim())}
        />
        <Pressable style={styles.searchBtn} onPress={() => setQuery(q.trim())}>
          <Text style={styles.searchBtnText}>OK</Text>
        </Pressable>
      </View>
      {error ? <Text style={styles.error}>{error}</Text> : null}

      <FlatList
        data={filtered}
        keyExtractor={(c) => String(c.id)}
        contentContainerStyle={styles.list}
        refreshing={refreshing}
        onRefresh={() => void onRefresh()}
        keyboardShouldPersistTaps="handled"
        ListHeaderComponent={
          mode === 'all' && summary ? (
            <View style={styles.headerBlock}>
              <View style={styles.kpiGrid}>
                <KpiCard label="Créances" value={summary.totalReceivable} money />
                <KpiCard label="En dette" value={String(summary.withDebt)} />
                <KpiCard label="À jour" value={String(summary.clear)} tone="ok" />
                <KpiCard label="Retard / plafond" value={String(summary.overdue)} tone="warn" />
              </View>
              {summary.topDebtors.length > 0 ? (
                <>
                  <Text style={styles.section}>Top débiteurs</Text>
                  {summary.topDebtors.slice(0, 5).map((c) => (
                    <Pressable key={`top-${c.id}`} style={styles.card} onPress={() => void openDetail(c)}>
                      <Text style={styles.cardName}>{c.name}</Text>
                      <MoneyText value={c.balance} style={styles.cardBalance} />
                    </Pressable>
                  ))}
                </>
              ) : null}
              <Text style={styles.section}>Clients ({filtered.length})</Text>
            </View>
          ) : (
            <Text style={styles.section}>{filtered.length} client(s)</Text>
          )
        }
        ListEmptyComponent={<Text style={styles.empty}>Aucun client</Text>}
        renderItem={({ item }) => (
          <Pressable style={styles.card} onPress={() => void openDetail(item)}>
            <View style={styles.cardTop}>
              <Text style={styles.cardName} numberOfLines={1}>
                {item.name}
              </Text>
              <View style={[styles.badge, { backgroundColor: `${STATUS_COLOR[item.status]}22` }]}>
                <Text style={[styles.badgeText, { color: STATUS_COLOR[item.status] }]}>
                  {STATUS_LABEL[item.status]}
                </Text>
              </View>
            </View>
            <Text style={styles.meta}>
              {item.phone || 'Sans téléphone'}
              {item.openSalesCount > 0 ? ` · ${item.openSalesCount} fiche(s)` : ''}
            </Text>
            <MoneyText value={item.balance} style={styles.cardBalance} />
          </Pressable>
        )}
      />

      <ModalShell
        visible={detail != null}
        onRequestClose={() => setDetail(null)}
        body={
          detail ? (
            <FlatList
              data={detail.timeline}
              keyExtractor={(t, i) => `${t.kind}-${t.at}-${i}`}
              contentContainerStyle={styles.detailList}
              keyboardShouldPersistTaps="handled"
              ListHeaderComponent={
                <View style={styles.detailHeader}>
                  <Text style={styles.detailTitle}>{detail.name}</Text>
                  <Text style={styles.meta}>
                    {STATUS_LABEL[detail.status]} · {detail.phone || 'Sans téléphone'}
                  </Text>
                  {detail.address ? <Text style={styles.meta}>{detail.address}</Text> : null}
                  <View style={styles.kpiGrid}>
                    <KpiCard label="Solde" value={detail.balance} money tone="warn" />
                    <KpiCard label="Disponible" value={detail.availableCredit} money />
                    <KpiCard label="Plafond" value={detail.creditLimit} money />
                  </View>

                  {canManage && detail.isActive ? (
                    <Pressable style={styles.primaryBtn} onPress={() => void openCreditSale()}>
                      <Text style={styles.primaryBtnText}>+ Vente à crédit</Text>
                    </Pressable>
                  ) : null}

                  <Text style={styles.section}>Fiches ouvertes</Text>
                  {openSales.length === 0 ? (
                    <Text style={styles.empty}>Aucune fiche ouverte</Text>
                  ) : (
                    openSales.map((s) => (
                      <Pressable
                        key={s.id}
                        onPress={() => setPaySaleId(s.id)}
                        style={[styles.saleRow, paySaleId === s.id && styles.saleRowActive]}>
                        <View style={styles.rowInfo}>
                          <Text style={styles.rowTitle}>#{saleDisplayRef(s)}</Text>
                          <Text style={styles.meta}>{formatDateTime(s.createdAt)}</Text>
                        </View>
                        <MoneyText value={s.balanceDue} style={styles.rowValue} />
                      </Pressable>
                    ))
                  )}

                  {detail.balance > 0.009 && canManage ? (
                    <>
                      <Text style={styles.section}>Encaisser un paiement</Text>
                      <TextInput
                        style={styles.input}
                        placeholder="Montant"
                        placeholderTextColor={BrandColors.textMuted}
                        keyboardType="decimal-pad"
                        value={payAmount}
                        onChangeText={setPayAmount}
                      />
                      <View style={styles.methodRow}>
                        {(['CASH', 'CARD', 'MOBILE_MONEY', 'BANK'] as const).map((m) => (
                          <Pressable
                            key={m}
                            onPress={() => {
                              setPayMethod(m);
                              if (m !== 'BANK') {
                                setPayBankId('');
                                setPayBankAccountId('');
                              }
                            }}
                            style={[styles.methodChip, payMethod === m && styles.methodChipActive]}>
                            <Text
                              style={[
                                styles.methodChipText,
                                payMethod === m && styles.methodChipTextActive,
                              ]}>
                              {m === 'CASH'
                                ? 'Espèces'
                                : m === 'CARD'
                                  ? 'Carte'
                                  : m === 'BANK'
                                    ? 'Banque'
                                    : 'Mobile'}
                            </Text>
                          </Pressable>
                        ))}
                      </View>
                      {payMethod === 'BANK' ? (
                        <>
                          <Text style={styles.meta}>Banque</Text>
                          <View style={styles.methodRow}>
                            {banks.map((bank) => {
                              const active = payBankId === bank.id;
                              return (
                                <Pressable
                                  key={bank.id}
                                  onPress={() => {
                                    setPayBankId(bank.id);
                                    setPayBankAccountId('');
                                  }}
                                  style={[styles.methodChip, active && styles.methodChipActive]}>
                                  <Text
                                    style={[
                                      styles.methodChipText,
                                      active && styles.methodChipTextActive,
                                    ]}>
                                    {bank.name}
                                  </Text>
                                </Pressable>
                              );
                            })}
                          </View>
                          <Text style={styles.meta}>Compte</Text>
                          <View style={styles.methodRow}>
                            {(banks.find((b) => b.id === payBankId)?.accounts ?? [])
                              .filter((a) => a.isActive)
                              .map((account) => {
                                const active = payBankAccountId === account.id;
                                return (
                                  <Pressable
                                    key={account.id}
                                    onPress={() => setPayBankAccountId(account.id)}
                                    style={[styles.methodChip, active && styles.methodChipActive]}>
                                    <Text
                                      style={[
                                        styles.methodChipText,
                                        active && styles.methodChipTextActive,
                                      ]}>
                                      {account.name}
                                    </Text>
                                  </Pressable>
                                );
                              })}
                          </View>
                          <Text style={styles.meta}>
                            Cet encaissement crédite le compte banque et crée une entrée INCOME.
                          </Text>
                        </>
                      ) : null}
                      {paySaleId != null ? (
                        <Pressable onPress={() => setPaySaleId(null)}>
                          <Text style={styles.link}>
                            Fiche #{saleDisplayRef({ id: paySaleId, txnNumber: openSales.find((s) => s.id === paySaleId)?.txnNumber })} (toucher pour FIFO)
                          </Text>
                        </Pressable>
                      ) : (
                        <Text style={styles.meta}>Allocation FIFO si aucune fiche choisie</Text>
                      )}
                      <TextInput
                        style={styles.input}
                        placeholder="Note (optionnel)"
                        placeholderTextColor={BrandColors.textMuted}
                        value={payNote}
                        onChangeText={setPayNote}
                      />
                      <Pressable
                        style={[
                          styles.primaryBtn,
                          (paying ||
                            (payMethod === 'BANK' &&
                              (payBankId === '' || payBankAccountId === ''))) &&
                            styles.disabled,
                        ]}
                        disabled={
                          paying ||
                          (payMethod === 'BANK' &&
                            (payBankId === '' || payBankAccountId === ''))
                        }
                        onPress={() => void submitPayment()}>
                        {paying ? (
                          <ActivityIndicator color="#fff" />
                        ) : (
                          <Text style={styles.primaryBtnText}>Encaisser</Text>
                        )}
                      </Pressable>
                      {payStatus ? <Text style={styles.payStatus}>{payStatus}</Text> : null}
                    </>
                  ) : null}

                  <Text style={styles.section}>Historique</Text>
                </View>
              }
              ListEmptyComponent={<Text style={styles.empty}>Aucun mouvement</Text>}
              renderItem={({ item: t }) => (
                <View style={styles.timelineRow}>
                  <View style={styles.rowInfo}>
                    <Text style={styles.rowTitle}>{t.label}</Text>
                    <Text style={styles.meta}>
                      {t.kind === 'SALE' ? 'Vente' : 'Paiement'} · {formatDateTime(t.at)}
                    </Text>
                  </View>
                  <MoneyText
                    value={t.amount}
                    style={[
                      styles.rowValue,
                      { color: t.kind === 'PAYMENT' ? BrandColors.ok : BrandColors.text },
                    ]}
                  />
                </View>
              )}
            />
          ) : null
        }
        footer={
          <View style={styles.footer}>
            <Pressable style={styles.secondaryBtn} onPress={() => setDetail(null)}>
              <Text style={styles.secondaryBtnText}>Fermer</Text>
            </Pressable>
          </View>
        }>
        <View style={styles.modalTop}>
          <Text style={styles.modalTopTitle}>Fiche crédit</Text>
          <Pressable onPress={() => setDetail(null)} hitSlop={12}>
            <Text style={styles.modalClose}>Fermer</Text>
          </Pressable>
        </View>
      </ModalShell>

      <ModalShell
        visible={saleVisible}
        onRequestClose={() => setSaleVisible(false)}
        body={
          <ScrollView
            contentContainerStyle={styles.saleBody}
            keyboardShouldPersistTaps="handled">
            <TextInput
              style={styles.input}
              placeholder="Rechercher produit / SKU…"
              placeholderTextColor={BrandColors.textMuted}
              value={productQuery}
              onChangeText={setProductQuery}
            />
            <View style={styles.productGrid}>
              {filteredProducts.map((product) => {
                const unit = product.saleUnits.find((row) => row.isDefault) ?? product.saleUnits[0];
                return (
                  <Pressable
                    key={product.id}
                    style={styles.productChip}
                    onPress={() => addCreditProduct(product)}>
                    <Text style={styles.productChipName}>{product.name}</Text>
                    <Text style={styles.meta}>
                      {formatMoney(Number(unit?.salePrice ?? 0))} · stock {String(product.stock)}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            <Text style={styles.section}>Panier</Text>
            {cart.length === 0 ? <Text style={styles.empty}>Panier vide</Text> : null}
            {cart.map((line) => {
              const product = productsById.get(line.productId);
              const price = effectiveUnitPrice(product, line, familyQtyMap);
              return (
                <View key={line.productSaleUnitId} style={styles.creditCartRow}>
                  <View style={styles.rowInfo}>
                    <Text style={styles.rowTitle}>{line.label}</Text>
                    <Text style={styles.meta}>{formatMoney(price)} / unité</Text>
                  </View>
                  <TextInput
                    style={styles.qtyInput}
                    keyboardType="decimal-pad"
                    value={
                      saleQtyDrafts[line.productSaleUnitId] ?? String(line.quantity)
                    }
                    onChangeText={(value) =>
                      setSaleQtyDrafts((previous) => ({
                        ...previous,
                        [line.productSaleUnitId]: value,
                      }))
                    }
                    onBlur={() => {
                      const raw =
                        saleQtyDrafts[line.productSaleUnitId] ?? String(line.quantity);
                      const quantity = Number(raw.replace(',', '.'));
                      if (Number.isFinite(quantity)) {
                        setCart((previous) =>
                          setCartLineQty(
                            previous,
                            products,
                            line.productSaleUnitId,
                            quantity,
                          ),
                        );
                      }
                      setSaleQtyDrafts((previous) => {
                        const next = { ...previous };
                        delete next[line.productSaleUnitId];
                        return next;
                      });
                    }}
                  />
                  <MoneyText value={price * line.quantity} style={styles.rowValue} />
                  <Pressable
                    hitSlop={8}
                    onPress={() =>
                      setCart((previous) =>
                        previous.filter(
                          (item) => item.productSaleUnitId !== line.productSaleUnitId,
                        ),
                      )
                    }>
                    <Text style={styles.danger}>×</Text>
                  </Pressable>
                </View>
              );
            })}

            <View style={styles.saleTotalRow}>
              <Text style={styles.section}>Total</Text>
              <MoneyText value={cartTotal} style={styles.saleTotal} />
            </View>
            <TextInput
              style={styles.input}
              placeholder="Acompte en espèces (optionnel)"
              placeholderTextColor={BrandColors.textMuted}
              keyboardType="decimal-pad"
              value={downPayment}
              onChangeText={setDownPayment}
            />
            <TextInput
              style={styles.input}
              placeholder="Note (optionnel)"
              placeholderTextColor={BrandColors.textMuted}
              value={saleNote}
              onChangeText={setSaleNote}
            />
            {saleStatus ? <Text style={styles.payStatus}>{saleStatus}</Text> : null}
          </ScrollView>
        }
        footer={
          <View style={styles.footer}>
            <Pressable
              style={[
                styles.primaryBtn,
                (saleBusy || cart.length === 0) && styles.disabled,
              ]}
              disabled={saleBusy || cart.length === 0}
              onPress={() => void submitCreditSale()}>
              {saleBusy ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.primaryBtnText}>Valider la vente à crédit</Text>
              )}
            </Pressable>
          </View>
        }>
        <View style={styles.modalTop}>
          <Text style={styles.modalTopTitle}>Nouvelle vente à crédit</Text>
          <Pressable onPress={() => setSaleVisible(false)} hitSlop={12}>
            <Text style={styles.modalClose}>Fermer</Text>
          </Pressable>
        </View>
      </ModalShell>
    </Screen>
  );
}

const styles = StyleSheet.create({
  blocked: { flex: 1, justifyContent: 'center', padding: Spacing.five },
  blockedText: { textAlign: 'center', color: BrandColors.textMuted },
  searchRow: {
    flexDirection: 'row',
    gap: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.two,
  },
  search: {
    flex: 1,
    borderWidth: 1,
    borderColor: BrandColors.borderStrong,
    borderRadius: 12,
    paddingHorizontal: Spacing.three,
    paddingVertical: 10,
    backgroundColor: BrandColors.surface,
    color: BrandColors.text,
  },
  searchBtn: {
    backgroundColor: BrandColors.primary,
    borderRadius: 12,
    paddingHorizontal: 16,
    justifyContent: 'center',
  },
  searchBtnText: { color: '#fff', fontWeight: '700' },
  error: {
    color: BrandColors.danger,
    fontWeight: '600',
    paddingHorizontal: Spacing.three,
    marginTop: Spacing.two,
  },
  list: { paddingHorizontal: Spacing.three, paddingBottom: Spacing.six, gap: Spacing.two },
  headerBlock: { gap: Spacing.two, marginBottom: Spacing.two },
  kpiGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  section: { marginTop: Spacing.two, fontSize: 15, fontWeight: '700', color: BrandColors.text },
  empty: { color: BrandColors.textMuted, textAlign: 'center', marginTop: Spacing.four },
  card: {
    backgroundColor: BrandColors.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: BrandColors.border,
    padding: Spacing.three,
    gap: 4,
    marginBottom: Spacing.two,
  },
  cardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  cardName: { flex: 1, fontSize: 16, fontWeight: '700', color: BrandColors.text },
  cardBalance: { fontWeight: '700', color: BrandColors.text, fontSize: 16 },
  badge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999 },
  badgeText: { fontSize: 12, fontWeight: '700' },
  meta: { fontSize: 12, color: BrandColors.textMuted },
  modalTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.three,
  },
  modalTopTitle: { fontSize: 18, fontWeight: '700', color: BrandColors.text },
  modalClose: { color: BrandColors.primary, fontWeight: '600' },
  detailList: { paddingHorizontal: Spacing.three, paddingBottom: Spacing.four },
  detailHeader: { gap: Spacing.two, marginBottom: Spacing.two },
  detailTitle: { fontSize: 22, fontWeight: '700', color: BrandColors.text },
  saleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    backgroundColor: BrandColors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: BrandColors.border,
    padding: Spacing.three,
    marginBottom: Spacing.two,
  },
  saleRowActive: { borderColor: BrandColors.primary, backgroundColor: BrandColors.primarySoft },
  input: {
    borderWidth: 1,
    borderColor: BrandColors.borderStrong,
    borderRadius: 12,
    paddingHorizontal: Spacing.three,
    paddingVertical: 12,
    fontSize: 16,
    color: BrandColors.text,
    backgroundColor: BrandColors.surface,
  },
  methodRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  methodChip: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: BrandColors.borderStrong,
    alignItems: 'center',
  },
  methodChipActive: { backgroundColor: BrandColors.primary, borderColor: BrandColors.primary },
  methodChipText: { fontWeight: '600', color: BrandColors.text, fontSize: 12 },
  methodChipTextActive: { color: '#fff' },
  link: { color: BrandColors.primary, fontWeight: '600' },
  primaryBtn: {
    backgroundColor: BrandColors.primary,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
  },
  primaryBtnText: { color: '#fff', fontWeight: '700' },
  disabled: { opacity: 0.55 },
  payStatus: { color: BrandColors.primaryHover, fontWeight: '600' },
  saleBody: {
    paddingHorizontal: Spacing.three,
    paddingBottom: Spacing.four,
    gap: Spacing.two,
  },
  productGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  productChip: {
    width: '48%',
    borderWidth: 1,
    borderColor: BrandColors.border,
    borderRadius: 12,
    padding: Spacing.three,
    backgroundColor: BrandColors.surface,
    gap: 3,
  },
  productChipName: { color: BrandColors.text, fontWeight: '700' },
  creditCartRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    borderWidth: 1,
    borderColor: BrandColors.border,
    borderRadius: 12,
    padding: Spacing.two,
    backgroundColor: BrandColors.surface,
  },
  qtyInput: {
    width: 56,
    borderWidth: 1,
    borderColor: BrandColors.borderStrong,
    borderRadius: 8,
    paddingVertical: 6,
    textAlign: 'center',
    color: BrandColors.text,
  },
  danger: { color: BrandColors.danger, fontSize: 22, fontWeight: '700' },
  saleTotalRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  saleTotal: { color: BrandColors.text, fontSize: 22, fontWeight: '700' },
  timelineRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    backgroundColor: BrandColors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: BrandColors.border,
    padding: Spacing.three,
    marginBottom: Spacing.two,
  },
  rowInfo: { flex: 1, gap: 2 },
  rowTitle: { fontWeight: '600', color: BrandColors.text },
  rowValue: { fontWeight: '700', color: BrandColors.text },
  footer: { padding: Spacing.three, backgroundColor: BrandColors.bg },
  secondaryBtn: {
    borderWidth: 1,
    borderColor: BrandColors.borderStrong,
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
    backgroundColor: BrandColors.surface,
  },
  secondaryBtnText: { fontWeight: '700', color: BrandColors.text },
});
