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

Si un parent requis est introuvable, le push marque `error` sur **cette** ligne.
Le curseur **avance quand même** (poison pill) pour ne pas geler tout l’historique ;
un redémarrage de l’agent rejoue depuis epoch et peut récupérer les lignes après arrival des parents.

Le pull utilise un curseur composite `updatedAt|uuid` pour ne pas sauter les lignes
au même horodatage.

### Ventes — `txnNumber`

- Requis côté métier (ticket / livraison).
- Si une Sale arrive en sync **sans** `txnNumber`, le nœud cible la crée puis backfill `txnNumber = id`
  (évite le blocage historique). Préférer corriger la source (`UPDATE … SET "txnNumber" = id`).

### Crédit (`CreditCustomer`, `CreditPayment`)

- `CreditCustomer` : **LWW** (comme la config) — fiche client / plafond / soft delete. Si online est plus récent que le brouillon local, online gagne.
- `CreditPayment` : **append-only** — insert si `uuid` inconnu (acomptes / remboursements).
- Les ventes crédit créent aussi `Sale` + `Delivery` (mêmes règles que la caisse) ; sans sync des clients crédit, ces ventes / livraisons restent bloquées (FK).

### Config (`Company`, `Department`, `DepartmentPrinterProfile`, `PackagingUnit`, `User`, `Store`, `Register`, `CreditCustomer`)

- LWW **symétrique** sur `max(updatedAt, deletedAt)` — un admin peut administrer depuis n’importe quel nœud.
- Soft delete obligatoire pour ces DELETE métier (tombstone synchronisable). **Hard delete = invisible au sync = résurrection** depuis l’autre nœud.
- Au pull / push : n’écraser que si `effectiveAt(incoming) > effectiveAt(existing)`.
- Soft delete plus récent gagne ; une édition ultérieure peut « undelete » (`deletedAt: null`) si son `updatedAt` est plus récent.

### Catalogue / stock (`Product`, `ProductSaleUnit`, `ProductVolumePrice`, `ProductFamily`, `ProductFamilyTier`, `ProductRecipe`, `RecipeComponent`)

- LWW sur `updatedAt`.
- Champ `stock` : **recalculé** côté réception après application des `StockMovement` append-only (ne pas LWW aveugle sur le stock).
- Soft delete : `deletedAt` non null → exclure des listes API actives.

### Mouvements & finance (`StockMovement`, `FinanceEntry`, `CashClosure`, `AuditLog`, `CreditPayment`) — append-only

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
- `Bank*` (hors périmètre sync actuel)

## API

- `GET /sync/pull?entity=&since=` — deltas depuis curseur (`since` = ISO ou `ISO|uuid`)
- `POST /sync/push` — batch d’enregistrements (`uuid` + payload)
- Auth : JWT admin/service ou `SYNC_API_KEY` (header `X-Sync-Key`)

## Soft delete API

Les `DELETE` métier doivent préférer `deletedAt = now()` plutôt qu’un hard delete, pour permettre la propagation.
