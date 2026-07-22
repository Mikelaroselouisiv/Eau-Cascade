# sync-agent

Métronome Local (machine mère) ↔ GCP : pull puis push, puis sync assets.

## Variables

| Variable | Défaut | Rôle |
|----------|--------|------|
| `LOCAL_API_URL` | `http://127.0.0.1:3000` | API locale |
| `REMOTE_API_URL` | `http://35.203.0.140` | API GCP |
| `SYNC_API_KEY` | — | Header `X-Sync-Key` (obligatoire) |
| `SYNC_INTERVAL_MS` | `45000` | Période du tick |
| `SYNC_NODE_ID` | `local-mother` | Identifiant nœud source |
| `LOCAL_ASSETS_DIR` | `./data/assets` | Dossier assets local |
| `GCS_ASSETS_URI` | — | ex. `gs://pos-entrprise-israel-assets/sync-assets` |

## Lancer

```bash
cd apps/sync-agent
npm install
set SYNC_API_KEY=...
npm start
```

Via Docker (machine mère) : inclus dans `infra/docker/docker-compose.server.yml`.

Règles de vérité : `docs/SYNC_RULES.md`.
