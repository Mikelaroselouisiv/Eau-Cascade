# Règles de vérité — sync Local (machine mère) ↔ GCP

## Métronome

1. **Pull GCP → local** (appliquer les deltas distants)
2. **Push local → GCP** (envoyer les deltas locaux)
3. Intervalle typique : 30–60 s (configurable via `SYNC_INTERVAL_MS`)

Les deux nœuds peuvent écrire hors-ligne ; la réconciliation se fait au retour réseau via `uuid` + `updatedAt` (+ soft delete `deletedAt`).

## Identité et FK

| Champ | Rôle |
|-------|------|
| `id` (Int) | PK locale / API REST — **jamais** identité sync |
| `uuid` | Identité stable cross-nœuds |
| `updatedAt` / `deletedAt` | LWW (`max`) |
| `companyUuid`, `departmentUuid`, … | Parents transportés sur le fil ; le nœud cible résout → `companyId` local |

Si un parent requis est introuvable, le push marque `error` et le **curseur n’avance pas** (retry).

## Règles par famille

### Ventes (`Sale`, `SaleItem`, `Payment`) — append-only

- Une vente créée sur un nœud **ne se modifie pas** côté sync (sauf statut CANCELLED/REFUNDED via API métier).
- Upsert par `uuid` ou `clientUuid` : si déjà présent → **no-op** (pas de doublon).
- Soft delete rare (admin) : propager `deletedAt`.

### Config (`Company`, `Department`, `DepartmentPrinterProfile`, `PackagingUnit`, `User`, `Store`, `Register`, `CreditCustomer`)

- LWW **symétrique** sur `max(updatedAt, deletedAt)` — un admin peut administrer depuis n’importe quel nœud.
- Soft delete obligatoire pour ces DELETE métier (tombstone synchronisable). **Hard delete = invisible au sync = résurrection** depuis l’autre nœud.
- Au pull / push : n’écraser que si `effectiveAt(incoming) > effectiveAt(existing)`.
- Soft delete plus récent gagne ; une édition ultérieure peut « undelete » (`deletedAt: null`) si son `updatedAt` est plus récent.
- `CreditCustomer` doit être synchronisé **avant** `Sale` (FK `Sale.creditCustomerUuid`).

### Crédit (`CreditCustomer`, `CreditPayment`)

- `CreditCustomer` : config LWW (fiche client AR).
- `CreditPayment` : LWW (acomptes / remboursements) — après `Sale` et `FinanceEntry` (FK optionnelles `saleUuid`, `financeEntryUuid`).
- Une vente crédit crée une `Sale` + `Payment(CREDIT)` + `Delivery(PENDING)` comme le POS ; le sync propage ces entités via l’ordre standard une fois le client résolu.

### Catalogue / stock (`Product`, `ProductSaleUnit`, `ProductVolumePrice`, `ProductRecipe`, `RecipeComponent`)

- LWW sur `updatedAt`.
- Champ `stock` : **recalculé** côté réception après application des `StockMovement` append-only (ne pas LWW aveugle sur le stock).
- Soft delete : `deletedAt` non null → exclure des listes API actives.

### Mouvements & finance (`StockMovement`, `FinanceEntry`, `CashClosure`, `AuditLog`) — append-only

- Insert si `uuid` inconnu ; jamais écraser un mouvement existant.
- `FinanceEntry` liée à une vente : suivre la vente (même `sale.uuid`).

### Achats / inventaire (`PurchaseOrder*`, `GoodsReceipt*`, `InventorySession*`)

- LWW sur en-têtes mutables (`status`, notes).
- Lignes : upsert par `uuid` ; soft delete si retiré.

### Assets (fichiers)

- Clé = chemin relatif (ex. `logos/company-1.png`).
- LWW sur mtime / hash ; bucket GCS = miroir distant ; dossier local Server = source privilégiée si conflit égal.

### Non synchronisé

- `Session` (tokens refresh locaux)
- `SyncState` (état par nœud)

## API

- `GET /sync/pull?entity=&since=` — deltas depuis curseur
- `POST /sync/push` — batch d’enregistrements (`uuid` + payload)
- Auth : JWT admin/service ou `SYNC_API_KEY` (header `X-Sync-Key`)

## Soft delete API

Les `DELETE` métier doivent préférer `deletedAt = now()` plutôt qu’un hard delete, pour permettre la propagation.
