# POS Entreprise Israel - Architecture

## Backend NestJS (domain modules)

- `auth`: login/register, refresh token, logout, session expiry
- `users`: users/roles (`ADMIN`, `MANAGER`, `CASHIER`)
- `sales`: vente atomique (check stock + decrement + sale + items + payments dans une transaction Prisma)
- `payments`: historique des paiements
- `inventory`: entrées/sorties/ajustements, mouvements, alertes stock faible
- `finance`: journal, depenses/recettes, cloture, ecarts
- `reports`: CA jour/semaine/mois, top produits, ventes par caissier, marge
- `departments`: multi-departements
- `stores`: multi-magasins et multi-caisses
- `audit`: logs d'audit securite et operationnels

## Electron + React

- Dashboard principal (`App.tsx`)
- Ecran caisse (panier temps reel + paiement cash/carte/mobile/split)
- Historique ventes
- Ecran stock
- Ecran admin
- Offline mode:
  - file locale via `offline-queue.ts`
  - sync automatique au lancement
  - retry reseau

## Impression thermique

- Service Electron: `src/main/thermal-printer.cjs`
- API: `window.desktopApp.printReceipt(saleData)`
- Support 58mm/80mm
- Template ticket:
  - entreprise, adresse, caissier, date/heure
  - lignes produits (nom, qty, prix)
  - total, mode paiement
- Fallback:
  - tentative ESC/POS raw via `node-thermal-printer` (si installe)
  - fallback Electron silent print si imprimante indisponible

## Endpoints REST

- `/sales`
- `/payments`
- `/inventory`
- `/reports`
- `/users`
- `/departments`
- `/stores`
- `/finance`

## Prisma

Le schema inclut:
- multi-store / registers / departments
- payments et statuts de vente (cancel/refund)
- mouvements de stock
- finance entries et cash closure
- sessions refresh token
- audit logs
