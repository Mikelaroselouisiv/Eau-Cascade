# POS Entreprise Israel

Monorepo point de vente dédié à **Entreprise Israel**.

## Apps

- `apps/backend` — API NestJS + Prisma + PostgreSQL
- `apps/desktop` — application Electron
- `apps/mobile` — application Expo
- `apps/sync-agent` — synchronisation magasin ↔ cloud

## Dev local (base séparée de Frères Baziles)

```powershell
# Postgres Israel uniquement (port 5433, DB pos_israel)
docker compose -f infra/docker/docker-compose.local-postgres.yml up -d

cd apps/backend
# .env pointe déjà vers 127.0.0.1:5433/pos_israel
npx prisma migrate deploy
npm run start:dev

cd ../desktop
npm run icons
npm run dev
```

Logo source unique : `assets/icons/icon.png`

## GCP

Projet : `pos-entrprise-israel` — voir `docs/GCP_ISRAEL.md` et `AGENTS.md`.
