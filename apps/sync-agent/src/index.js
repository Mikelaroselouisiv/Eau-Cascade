import { createApiClient, replicateDirection } from './replicate.js';
import { resolveDefaultAssetsDir, syncAssets } from './assets.js';

const LOCAL_API_URL = process.env.LOCAL_API_URL || 'http://127.0.0.1:3000';
const REMOTE_API_URL = process.env.REMOTE_API_URL || 'http://35.203.0.140';
const SYNC_API_KEY = process.env.SYNC_API_KEY || '';
const SYNC_INTERVAL_MS = Number(process.env.SYNC_INTERVAL_MS || 45_000);
const NODE_ID = process.env.SYNC_NODE_ID || 'local-mother';
const GCS_ASSETS_URI =
  process.env.GCS_ASSETS_URI ||
  process.env.GCS_ASSETS_PREFIX ||
  '';
const LOCAL_ASSETS_DIR = resolveDefaultAssetsDir();

if (!SYNC_API_KEY) {
  console.error('[sync-agent] SYNC_API_KEY requis');
  process.exit(1);
}

const local = createApiClient(LOCAL_API_URL, SYNC_API_KEY);
const remote = createApiClient(REMOTE_API_URL, SYNC_API_KEY);

/** Curseurs en mémoire (restart = full catch-up depuis epoch — acceptable V1). */
const pullCursors = Object.create(null);
const pushCursors = Object.create(null);

let running = false;

async function tick() {
  if (running) {
    console.warn('[sync-agent] tick précédent encore en cours — skip');
    return;
  }
  running = true;
  const started = Date.now();
  try {
    // 1) Pull GCP → local
    const pullSummary = await replicateDirection({
      from: remote,
      to: local,
      cursors: pullCursors,
      sourceNodeId: 'gcp',
      label: 'pull-gcp→local',
    });
    console.log('[sync-agent]', JSON.stringify(pullSummary));

    // 2) Push local → GCP
    const pushSummary = await replicateDirection({
      from: local,
      to: remote,
      cursors: pushCursors,
      sourceNodeId: NODE_ID,
      label: 'push-local→gcp',
    });
    console.log('[sync-agent]', JSON.stringify(pushSummary));

    // 3) Assets
    const assets = await syncAssets({
      localDir: LOCAL_ASSETS_DIR,
      gcsUri: GCS_ASSETS_URI,
    });
    console.log('[sync-agent] assets', assets);
  } catch (err) {
    const message = err?.response?.data
      ? JSON.stringify(err.response.data)
      : err?.message || String(err);
    console.error('[sync-agent] erreur', message);
  } finally {
    running = false;
    console.log(`[sync-agent] tick ${Date.now() - started}ms`);
  }
}

console.log(
  `[sync-agent] démarrage — local=${LOCAL_API_URL} remote=${REMOTE_API_URL} interval=${SYNC_INTERVAL_MS}ms`,
);
void tick();
setInterval(() => void tick(), SYNC_INTERVAL_MS);
