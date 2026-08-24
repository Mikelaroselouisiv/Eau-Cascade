# POS Backend (NestJS + Prisma + PostgreSQL)

Backend API modulaire pour un systeme POS professionnel.

## Stack

- NestJS
- Prisma ORM
- PostgreSQL
- JWT + Passport
- Docker / Docker Compose
- class-validator

## Modules

- `auth`: register/login, JWT
- `users`: gestion utilisateurs (`ADMIN`, `CASHIER`)
- `products`: catalogue et mise a jour des stocks
- `sales`: ventes et lignes de vente
- `inventory`: verification et decrement du stock

## Endpoints

### Auth
- `POST /auth/register`
- `POST /auth/login`

### Users (admin only)
- `GET /users`
- `GET /users/:id`

### Products
- `POST /products` (admin)
- `GET /products` (admin, cashier)
- `PATCH /products/:id` (admin)

### Sales
- `POST /sales` (admin, cashier)
- `GET /sales` (admin, cashier)

## Base de donnees : PostgreSQL sur l’EC2 (defaut)

Le developpement cible **la meme base** que la prod sur l’EC2 (`pos_postgres_prod`). Connexion depuis le PC par **tunnel SSH** (Postgres n’est pas expose publiquement).

1. Sur l’EC2 : `docker-compose.prod.yml` avec Postgres + backend (deja en place).
2. Sur ton PC, terminal **laisse ouvert** :
   - Windows (racine du repo) :  
     `powershell -ExecutionPolicy Bypass -File infra/scripts/ec2-db-tunnel.ps1 -PemPath "apps/freresbazilepos.pem" -Ec2Host "VOTRE_IP_PUBLIQUE"`
   - macOS / Linux :  
     `infra/scripts/ec2-db-tunnel.sh ~/.ssh/cle.pem VOTRE_IP_PUBLIQUE`
3. `apps/backend/.env` : `DATABASE_URL` sur **127.0.0.1:15432** (defaut du script ; mot de passe = `docker-compose.prod.yml`).
4. Migrations / seed : `npm run prisma:migrate` et `npm run prisma:seed` depuis `apps/backend` **avec le tunnel actif** (ils s’executent contre l’EC2).

Sans tunnel ni Internet, Prisma / Nest ne peuvent pas joindre la base. Pour un Postgres **uniquement sur votre machine** (hors EC2), voir `infra/docker/docker-compose.local-postgres.yml` et `DATABASE_URL` sur `localhost:5432` dans `.env`.

## Lancement local (sans Docker)

1. Installer Node.js (LTS) et npm
2. Installer les dependances:
   - `npm install`
3. Tunnel SSH actif + `.env` avec `DATABASE_URL` vers **127.0.0.1:15432** (voir `.env.example`)
4. Generer Prisma client:
   - `npm run prisma:generate`
5. Appliquer migration:
   - `npm run prisma:migrate`
6. (Optionnel) Seed d’urgence uniquement avec `FORCE_ADMIN_RESET=1` — par défaut **aucun** compte automatique ; le premier admin se crée via l’app (écran « Configuration initiale ») ou `POST /auth/register` quand la base est vide.
7. Lancer l'API:
   - `npm run start:dev`

## Lancement Docker (dev — backend seul, DB sur EC2)

Fichier : `infra/docker/docker-compose.yml` (plus de Postgres local dans ce fichier).

1. Ouvrir le **tunnel SSH** vers l’EC2 (voir ci-dessus).
2. `cd infra/docker && docker compose up --build -d`  
   Le conteneur utilise `host.docker.internal:15432` pour suivre le tunnel sur l’hôte.
3. Seed si besoin : `docker exec -it pos_backend npx prisma db seed`

Postgres local optionnel : `docker compose -f docker-compose.local-postgres.yml up -d` puis adapter `DATABASE_URL` et retirer le service `backend` du fichier dev ou lancer Nest sur l’hôte uniquement.

## Production locale (image ECR, sans build)

Fichier `infra/docker/docker-compose.prod.yml`. Sur la machine : AWS CLI + droits ECR, Docker.

```bash
cd infra/docker
cp .env.prod.example .env.prod
# éditer .env.prod (JWT_SECRET)

aws ecr get-login-password --region us-east-2 | docker login --username AWS --password-stdin 421983920969.dkr.ecr.us-east-2.amazonaws.com

docker compose -f docker-compose.prod.yml --env-file .env.prod pull
docker compose -f docker-compose.prod.yml --env-file .env.prod up -d
```

Conteneurs : `pos_postgres_prod`, `pos_backend_prod` (API port 3000).

## Premier administrateur

- Tant qu’**aucun** utilisateur n’existe : `GET /auth/setup-status` → `needsFirstUser: true` ; `POST /auth/register` crée le **premier compte** en rôle **ADMIN** avec le téléphone et le mot de passe choisis.
- Ensuite : `POST /auth/register` est **refusé** ; les autres comptes sont créés par un admin (`POST /users`).
- Secours : `FORCE_ADMIN_RESET=1 npm run prisma:seed` (variables optionnelles `SEED_ADMIN_PHONE`, `SEED_ADMIN_PASSWORD`).

## Notes

- Logging middleware global actif
- Validation DTO globale active
- Filtre global des exceptions HTTP
