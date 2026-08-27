# POS Eau Cascade

Monorepo point de vente dédié à **Eau Cascade**.

## Apps

- `apps/backend` — API NestJS + Prisma + PostgreSQL
- `apps/desktop` — application Electron
- `apps/mobile` — application Expo
- `apps/sync-agent` — synchronisation magasin ↔ cloud

## Dev local (base séparée de Frères Baziles)

```powershell
# Postgres Eau Cascade uniquement (port 5434, DB pos_eau_cascade)
docker compose -f infra/docker/docker-compose.local-postgres.yml up -d

cd apps/backend
# .env pointe déjà vers 127.0.0.1:5434/pos_eau_cascade
npx prisma migrate deploy
npm run start:dev

cd ../desktop
npm run icons
npm run dev
```

Logo source unique : `assets/icons/icon.png`

## Livraison production

```powershell
powershell -ExecutionPolicy Bypass -File infra/scripts/ship-all.ps1 -Bump patch -Commit
```

Voir `docs/DEPLOYMENT.md` et `.cursor/skills/ship-all/SKILL.md`.

## GCP

Projet : `eau-cascade` — voir `docs/GCP_EAU_CASCADE.md` et `AGENTS.md`.
