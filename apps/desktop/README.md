# POS Desktop (Electron + React)

Application desktop POS dans `apps/desktop`, connectee au backend NestJS (voir **`src/renderer/config/public-api.ts`**).

## URL du backend (dev vs prod)

- **Production (installateur / `vite build`)** : constante **`PUBLIC_API_BASE_URL`** dans **`src/renderer/config/public-api.ts`** (URL publique, **port 80** derrière Nginx → Nest sur `:3000`, voir `infra/nginx/`). C’est l’endroit unique à modifier si l’URL change.
- **Développement** (`npm run dev`) : **`http://localhost:3000`** par défaut (Nest local), sans configuration.
- **Surcharge optionnelle** : variable **`VITE_API_URL`** au build (CI, test) — voir `.env.production.example`.

### Mode semi-autonome (SQLite)

- Fichier **`pos-local.sqlite`** dans le répertoire utilisateur de l’app (Electron `userData`) : **file d’attente des ventes** hors ligne + **cache du catalogue** produits.
- Au retour réseau, la file est synchronisée vers l’API (`POST /sales`). Le badge **« N hors ligne »** dans la barre latérale indique les ventes en attente.

La persistance utilise **sql.js** (SQLite compilé en WebAssembly, sans module natif à compiler).

## Logo & identité visuelle

- **Fichier source unique** : **`assets/icons/icon.png`** (votre logo — ne jamais écrasé par un script).
- **`npm run icons`** : copie vers `build/` + `public/` et génère les `.ico` Windows.
- Vite resynchronise le PNG au `npm run dev` / `npm run build`.
- **Barre des tâches en dev** : icône Electron ; logo FB complet après installateur packagé.

## Structure

- `src/main`: process Electron (`main.cjs`, `preload.cjs`)
- `src/renderer`: interface React (login, produits, panier, vente)
- `src/renderer/services/api.ts`: appels API backend

## Commandes

À lancer depuis **`apps/desktop`** (pas `apps/backend`).

- `npm install`
- `npm run dev` : lance Vite + Electron en mode developpement
- `npm run build` : build React renderer
- `npm run start` : lance Electron en mode local (après `npm run build`)
- **`npm run dist:win`** : build + **installateur Windows** (`release/POS Entreprise Israel Setup x.x.x.exe`). Sans certificat de signature : `forceCodeSigning` est désactivé dans `package.json` (Windows peut afficher « éditeur inconnu »).

Pour un autre serveur que celui défini dans `public-api.ts`, modifie **`PUBLIC_API_BASE_URL`** ou utilise **`VITE_API_URL`** au build, puis `npm run dist:win`.

### L’installateur ne joint pas l’API (EC2)

1. **Security group AWS** : autoriser le trafic **entrant TCP 3000** vers l’instance (depuis ton IP ou `0.0.0.0/0` pour test). Sans cette règle, rien n’atteint Nest depuis ton PC.
2. Vérifier dans le navigateur : `http://TON_IP:3000/auth/setup-status` doit afficher du JSON.
3. Rebuild l’exe seulement si tu changes le code Electron ou l’URL dans `public-api.ts`.

## Tester dans le navigateur (sans Electron)

1. **Backend + Postgres en local** (recommandé pour le dev)  
   - Postgres : `docker compose -f infra/docker/docker-compose.local-postgres.yml up -d` (depuis la racine du monorepo).  
   - API : `cd apps/backend && npm run start:dev` (écoute sur **3000**).  
   - UI : `cd apps/desktop && npm run dev` → ouvre **http://localhost:5173**  
   - En dev, l’app appelle **`http://localhost:3000`** (voir `api.ts`).

2. **Vérifier l’API seule** (même onglet ou navigateur)  
   - `http://localhost:3000/auth/setup-status` → JSON du type `{"needsFirstUser":true}` ou `false`.  
   - Si erreur **500** : Postgres arrêté, mauvaise `DATABASE_URL`, ou migrations Prisma manquantes.

3. **Option avancée — dev sur l’EC2** (tu peux ignorer ça si tu développes en local)  
   - Fichier : **`apps/desktop/.env.development`**.  
   - Ce n’est **pas** obligatoire : sans rien changer, le dev utilise **`http://localhost:3000`**.  
   - Tu n’ajoutes `VITE_API_URL=...` que si tu veux explicitement que Vite appelle le serveur distant pendant `npm run dev`.  
   - Prérequis : port **3000** ouvert sur le security group de l’EC2.

4. **Preview du build prod** (même URL que l’installateur)  
   - `npm run build && npm run preview` → utilise **`PUBLIC_API_BASE_URL`** dans `public-api.ts` (pas localhost).

## Fonctionnalites POS incluses

- Login utilisateur (`/auth/login`)
- Liste des produits (`/products`)
- Panier local avec total
- Validation vente (`/sales`)
- Gestion loading + erreurs basiques
