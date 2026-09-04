import { Ionicons } from '@expo/vector-icons';
import * as Crypto from 'expo-crypto';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  FlatList,
  Modal,
  Pressable,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { useFocusEffect } from 'expo-router';

import { Screen } from '@/components/Screen';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useAuth } from '@/context/AuthContext';
import { useTheme } from '@/hooks/use-theme';
import { isLikelyNetworkError } from '@/services/api-errors';
import { createSale } from '@/services/api';
import { printReceipt } from '@/services/bluetooth-printer';
import { isOnline } from '@/services/net';
import { enqueueSale, syncSalesQueue } from '@/services/offline-queue';
import { loadProductsWithCache } from '@/services/product-cache';
import { buildSaleReceiptData } from '@/services/receipt';
import type { CreateSalePayload, PaymentPayload, Product } from '@/types/api';
import { usePendingSalesCount } from '@/hooks/usePendingSalesCount';
import {
  addLineToCart,
  bumpCartLine,
  effectiveUnitPrice,
  type CartLine,
} from '@/utils/posCart';
import { emitPendingSalesChanged } from '@/utils/eventBus';
import { posPaymentOptions } from '@/utils/posCollect';

const ACCENT = '#208AEF';
const DANGER = '#DC2626';
const WARNING = '#B45309';
const WARNING_BG = '#FEF3C7';

function initials(name: string): string {
  return name.trim().slice(0, 2).toUpperCase();
}

export default function PosScreen() {
  const { user } = useAuth();
  const theme = useTheme();
  const cashierLabel = user?.fullName?.trim() || user?.phone || 'Caissier';
  const departmentId = typeof user?.departmentId === 'number' ? user.departmentId : undefined;
  const paymentChoices = useMemo(
    () => posPaymentOptions(user),
    [user?.role, user?.productionDepartmentIds],
  );

  const [products, setProducts] = useState<Product[]>([]);
  const [cart, setCart] = useState<CartLine[]>([]);
  const [paymentMethod, setPaymentMethod] = useState<PaymentPayload['method']>('CASH');
  const [clientName, setClientName] = useState('');
  const [cartVisible, setCartVisible] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const pendingCount = usePendingSalesCount();

  const loadProducts = useCallback(() => {
    loadProductsWithCache(departmentId)
      .then(setProducts)
      .catch(() => setStatus('Catalogue indisponible (hors ligne, pas de cache)'));
  }, [departmentId]);

  useEffect(() => {
    loadProducts();
  }, [loadProducts]);

  useFocusEffect(
    useCallback(() => {
      syncSalesQueue()
        .then((result) => {
          if (result.synced > 0) emitPendingSalesChanged();
        })
        .catch(() => undefined);
    }, []),
  );

  useEffect(() => {
    if (!status) return;
    const t = setTimeout(() => setStatus(null), 4000);
    return () => clearTimeout(t);
  }, [status]);

  function addProduct(product: Product) {
    const { cart: next, error } = addLineToCart(cart, product);
    if (error) {
      setStatus(error);
      return;
    }
    setCart(next);
  }

  function bumpQty(productSaleUnitId: number, delta: number) {
    setCart((prev) => bumpCartLine(prev, products, productSaleUnitId, delta));
  }

  const cartTotal = cart.reduce((sum, line) => {
    const product = products.find((p) => p.id === line.productId);
    return sum + effectiveUnitPrice(product, line) * line.quantity;
  }, 0);

  const cartItemCount = cart.reduce((sum, line) => sum + line.quantity, 0);

  function quantityInCart(product: Product): number {
    return cart
      .filter((l) => l.productId === product.id)
      .reduce((sum, l) => sum + l.quantity, 0);
  }

  function clearCart() {
    setCart([]);
    setClientName('');
    setCartVisible(false);
  }

  async function checkout() {
    if (cart.length === 0 || submitting) return;
    setSubmitting(true);
    const total = cartTotal;
    const method = paymentChoices.some((opt) => opt.method === paymentMethod)
      ? paymentMethod
      : 'CASH';
    const payload: CreateSalePayload = {
      items: cart.map((l) => ({ productSaleUnitId: l.productSaleUnitId, quantity: l.quantity })),
      payments: [{ method, amount: total }],
      clientName: clientName || null,
      clientUuid: Crypto.randomUUID(),
    };

    try {
      const online = await isOnline();
      if (!online) {
        await enqueueSale(payload);
        emitPendingSalesChanged();
        setStatus('Hors ligne : vente mise en file d’attente');
        clearCart();
        return;
      }

      const sale = await createSale(payload);
      setStatus(`Vente #${sale.id} enregistrée`);

      try {
        const receiptData = await buildSaleReceiptData({
          items: cart.map((l) => {
            const product = products.find((p) => p.id === l.productId);
            return { name: l.label, qty: l.quantity, price: effectiveUnitPrice(product, l) };
          }),
          total,
          paymentMode: method,
          clientName,
          cashier: cashierLabel,
          departmentId,
        });
        await printReceipt(receiptData);
      } catch {
        setStatus(`Vente #${sale.id} enregistrée (échec impression)`);
      }

      clearCart();
      loadProducts();
    } catch (e) {
      const online = await isOnline();
      if (isLikelyNetworkError(e) || !online) {
        await enqueueSale(payload);
        emitPendingSalesChanged();
        setStatus('Réseau indisponible : vente mise en file d’attente');
        clearCart();
      } else {
        setStatus('Échec vente (stock ou données)');
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Screen style={styles.container}>
      {status && (
        <ThemedView type="backgroundElement" style={styles.status}>
          <Ionicons name="information-circle-outline" size={18} color={ACCENT} />
          <ThemedText type="small" style={styles.statusText}>
            {status}
          </ThemedText>
        </ThemedView>
      )}

      {pendingCount > 0 && (
        <View style={styles.pendingBadge}>
          <Ionicons name="cloud-upload-outline" size={16} color={WARNING} />
          <ThemedText type="small" style={styles.pendingBadgeText}>
            {pendingCount} vente(s) en attente de synchronisation
          </ThemedText>
        </View>
      )}

      <FlatList
        data={products}
        keyExtractor={(p) => String(p.id)}
        numColumns={2}
        style={styles.productList}
        contentContainerStyle={styles.grid}
        columnWrapperStyle={styles.gridRow}
        renderItem={({ item }) => {
          const inCart = quantityInCart(item);
          return (
            <Pressable
              style={({ pressed }) => [
                styles.productCard,
                { backgroundColor: theme.backgroundElement },
                pressed && styles.productCardPressed,
              ]}
              android_ripple={{ color: '#00000014' }}
              onPress={() => addProduct(item)}>
              <View style={styles.productAvatar}>
                <ThemedText type="smallBold" style={styles.productAvatarText}>
                  {initials(item.name)}
                </ThemedText>
              </View>
              {inCart > 0 && (
                <View style={styles.productBadge}>
                  <ThemedText style={styles.productBadgeText}>{inCart}</ThemedText>
                </View>
              )}
              <ThemedText type="smallBold" numberOfLines={2} style={styles.productName}>
                {item.name}
              </ThemedText>
              <ThemedText style={styles.productPrice}>
                {Number(item.saleUnits?.[0]?.salePrice ?? 0).toFixed(2)}
              </ThemedText>
            </Pressable>
          );
        }}
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <Ionicons name="storefront-outline" size={40} color="#9AA0A6" />
            <ThemedText themeColor="textSecondary" style={styles.emptyStateText}>
              Aucun produit disponible
            </ThemedText>
          </View>
        }
      />

      <Pressable
        style={[styles.cartButton, cart.length === 0 && styles.cartButtonEmpty]}
        onPress={() => setCartVisible(true)}>
        <Ionicons name="cart-outline" size={20} color="#ffffff" />
        <ThemedText style={styles.cartButtonText}>
          Panier ({cartItemCount}) — {cartTotal.toFixed(2)}
        </ThemedText>
      </Pressable>

      <Modal
        visible={cartVisible}
        animationType="slide"
        onRequestClose={() => setCartVisible(false)}>
        <Screen edges={['top', 'bottom', 'left', 'right']} keyboardAvoiding style={styles.container}>
          <View style={styles.cartHeader}>
            <ThemedText type="subtitle">Panier</ThemedText>
            <Pressable onPress={() => setCartVisible(false)} hitSlop={12} style={styles.closeButton}>
              <Ionicons name="close" size={22} color="#60646C" />
            </Pressable>
          </View>

          <FlatList
            data={cart}
            keyExtractor={(l) => String(l.productSaleUnitId)}
            style={styles.cartList}
            contentContainerStyle={styles.cartListContent}
            keyboardShouldPersistTaps="handled"
            renderItem={({ item }) => {
              const product = products.find((p) => p.id === item.productId);
              const price = effectiveUnitPrice(product, item);
              return (
                <ThemedView type="backgroundElement" style={styles.cartRow}>
                  <View style={styles.cartRowInfo}>
                    <ThemedText style={styles.cartRowLabel} numberOfLines={2}>
                      {item.label}
                    </ThemedText>
                    <ThemedText type="small" themeColor="textSecondary">
                      {price.toFixed(2)} / unité
                    </ThemedText>
                  </View>
                  <View style={styles.qtyControls}>
                    <Pressable onPress={() => bumpQty(item.productSaleUnitId, -1)} hitSlop={8}>
                      <Ionicons name="remove-circle-outline" size={26} color={ACCENT} />
                    </Pressable>
                    <ThemedText style={styles.qtyValue}>{item.quantity}</ThemedText>
                    <Pressable onPress={() => bumpQty(item.productSaleUnitId, 1)} hitSlop={8}>
                      <Ionicons name="add-circle-outline" size={26} color={ACCENT} />
                    </Pressable>
                  </View>
                  <ThemedText style={styles.cartRowTotal}>
                    {(price * item.quantity).toFixed(2)}
                  </ThemedText>
                </ThemedView>
              );
            }}
            ListEmptyComponent={
              <View style={styles.emptyCart}>
                <Ionicons name="cart-outline" size={36} color="#9AA0A6" />
                <ThemedText themeColor="textSecondary">Panier vide</ThemedText>
              </View>
            }
          />

          <View style={styles.cartFooter}>
            <View style={styles.inputWrapper}>
              <Ionicons name="person-outline" size={18} color="#9AA0A6" style={styles.inputIcon} />
              <TextInput
                style={styles.input}
                placeholder="Nom du client (optionnel)"
                value={clientName}
                onChangeText={setClientName}
                returnKeyType="done"
              />
            </View>

            <View style={styles.paymentRow}>
              {paymentChoices.map(({ method, label, icon }) => {
                const active = paymentMethod === method;
                return (
                  <Pressable
                    key={method}
                    onPress={() => setPaymentMethod(method)}
                    style={[styles.paymentButton, active && styles.paymentButtonActive]}>
                    <Ionicons name={icon} size={18} color={active ? '#ffffff' : '#60646C'} />
                    <ThemedText type="small" style={active ? styles.paymentLabelActive : undefined}>
                      {label}
                    </ThemedText>
                  </Pressable>
                );
              })}
            </View>

            <View style={styles.totalRow}>
              <ThemedText themeColor="textSecondary">Total</ThemedText>
              <ThemedText type="title" style={styles.totalValue}>
                {cartTotal.toFixed(2)}
              </ThemedText>
            </View>

            <View style={styles.actionsRow}>
              <Pressable style={styles.clearButton} onPress={clearCart}>
                <Ionicons name="trash-outline" size={18} color={DANGER} />
                <ThemedText style={styles.clearButtonText}>Vider</ThemedText>
              </Pressable>
              <Pressable
                style={[styles.checkoutButton, (submitting || cart.length === 0) && styles.buttonDisabled]}
                onPress={checkout}
                disabled={submitting || cart.length === 0}>
                <Ionicons name="checkmark-circle-outline" size={20} color="#ffffff" />
                <ThemedText style={styles.checkoutButtonText}>
                  {submitting ? 'Encaissement…' : 'Encaisser'}
                </ThemedText>
              </Pressable>
            </View>
          </View>
        </Screen>
      </Modal>
    </Screen>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  status: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    padding: Spacing.two,
    marginHorizontal: Spacing.three,
    marginTop: Spacing.two,
    borderRadius: Spacing.two,
  },
  statusText: { flex: 1 },
  pendingBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    marginHorizontal: Spacing.three,
    marginTop: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderRadius: Spacing.two,
    backgroundColor: WARNING_BG,
  },
  pendingBadgeText: { color: WARNING, flex: 1 },
  productList: { flex: 1 },
  grid: { padding: Spacing.three, flexGrow: 1 },
  gridRow: { gap: Spacing.three },
  productCard: {
    flex: 1,
    marginBottom: Spacing.three,
    padding: Spacing.three,
    borderRadius: Spacing.three,
    minHeight: 132,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 4,
    elevation: 2,
  },
  productCardPressed: { opacity: 0.85 },
  productAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#208AEF1A',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Spacing.two,
  },
  productAvatarText: { color: ACCENT },
  productBadge: {
    position: 'absolute',
    top: Spacing.two,
    right: Spacing.two,
    minWidth: 22,
    height: 22,
    paddingHorizontal: 5,
    borderRadius: 11,
    backgroundColor: ACCENT,
    alignItems: 'center',
    justifyContent: 'center',
  },
  productBadgeText: { color: '#ffffff', fontSize: 12, fontWeight: '700' },
  productName: { marginBottom: Spacing.one },
  productPrice: { color: ACCENT, fontWeight: '700', marginTop: 'auto' },
  emptyState: { alignItems: 'center', gap: Spacing.two, paddingVertical: Spacing.six },
  emptyStateText: { textAlign: 'center' },
  cartButton: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: Spacing.two,
    backgroundColor: ACCENT,
    margin: Spacing.three,
    paddingVertical: Spacing.three,
    borderRadius: Spacing.three,
    shadowColor: ACCENT,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 6,
    elevation: 3,
  },
  cartButtonEmpty: { backgroundColor: '#9AA0A6', shadowOpacity: 0 },
  cartButtonText: { color: '#ffffff', fontWeight: '600', fontSize: 16 },
  cartHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.three,
  },
  closeButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#0000000A',
    alignItems: 'center',
    justifyContent: 'center',
  },
  cartList: { flex: 1 },
  cartListContent: { paddingHorizontal: Spacing.three, gap: Spacing.two, flexGrow: 1 },
  emptyCart: { alignItems: 'center', gap: Spacing.two, paddingVertical: Spacing.six },
  cartRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: Spacing.three,
    borderRadius: Spacing.three,
    gap: Spacing.three,
  },
  cartRowInfo: { flex: 1, gap: 2 },
  cartRowLabel: { fontWeight: '600' },
  cartRowTotal: { width: 74, textAlign: 'right', fontWeight: '700' },
  qtyControls: { flexDirection: 'row', alignItems: 'center', gap: Spacing.one },
  qtyValue: { minWidth: 24, textAlign: 'center', fontWeight: '600' },
  cartFooter: {
    padding: Spacing.three,
    gap: Spacing.three,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#8886',
  },
  inputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#8886',
    borderRadius: Spacing.three,
    paddingHorizontal: Spacing.three,
    gap: Spacing.two,
  },
  inputIcon: {},
  input: { flex: 1, paddingVertical: Spacing.three },
  paymentRow: { flexDirection: 'row', gap: Spacing.two },
  paymentButton: {
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: Spacing.one,
    paddingVertical: Spacing.two,
    borderRadius: Spacing.three,
    borderWidth: 1,
    borderColor: '#8886',
  },
  paymentButtonActive: { backgroundColor: ACCENT, borderColor: ACCENT },
  paymentLabelActive: { color: '#ffffff' },
  totalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: Spacing.one,
  },
  totalValue: { fontSize: 28 },
  actionsRow: { flexDirection: 'row', gap: Spacing.two },
  clearButton: {
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: Spacing.one,
    paddingVertical: Spacing.three,
    borderRadius: Spacing.three,
    borderWidth: 1,
    borderColor: DANGER,
  },
  clearButtonText: { color: DANGER, fontWeight: '600' },
  checkoutButton: {
    flex: 2,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: Spacing.two,
    paddingVertical: Spacing.three,
    borderRadius: Spacing.three,
    backgroundColor: ACCENT,
  },
  buttonDisabled: { opacity: 0.5 },
  checkoutButtonText: { color: '#ffffff', fontWeight: '600', fontSize: 16 },
});
