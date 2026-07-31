import axios from 'axios';
import { ENTITY_ORDER } from './entities.js';

export function createApiClient(baseURL, syncKey) {
  return axios.create({
    baseURL: baseURL.replace(/\/$/, ''),
    timeout: 60_000,
    headers: {
      'X-Sync-Key': syncKey,
      'Content-Type': 'application/json',
    },
  });
}

/**
 * Pull deltas from `from` and push them to `to`.
 * Curseur avancé seulement si le batch a 0 erreur (sinon retry au tick suivant).
 */
export async function replicateDirection({
  from,
  to,
  cursors,
  sourceNodeId,
  label,
}) {
  const summary = { label, entities: {} };

  for (const entity of ENTITY_ORDER) {
    let since = cursors[entity] || '1970-01-01T00:00:00.000Z';
    let pulled = 0;
    let applied = 0;
    let skipped = 0;
    let errors = 0;
    const errorSamples = [];
    let pages = 0;
    let blocked = false;

    try {
      for (;;) {
        pages += 1;
        const { data } = await from.get('/sync/pull', {
          params: { entity, since, take: 200 },
        });
        const records = data.records || [];
        if (records.length === 0) {
          if (data.nextCursor) cursors[entity] = data.nextCursor;
          break;
        }

        pulled += records.length;
        const pushRes = await to.post('/sync/push', {
          entity,
          sourceNodeId,
          records,
        });
        const batchApplied = pushRes.data?.applied ?? 0;
        const batchSkipped = pushRes.data?.skipped ?? 0;
        const batchErrors = pushRes.data?.errors ?? 0;
        applied += batchApplied;
        skipped += batchSkipped;
        errors += batchErrors;

        if (batchErrors > 0) {
          const failed = (pushRes.data?.results || [])
            .filter((r) => r.action === 'error')
            .slice(0, 3)
            .map((r) => `${r.uuid}: ${r.error || 'error'}`);
          errorSamples.push(...failed);
          // Ne pas avancer le curseur : ce batch sera retenté.
          blocked = true;
          break;
        }

        since = data.nextCursor || records[records.length - 1]?.updatedAt || since;
        cursors[entity] = since;

        if (records.length < 200 || pages > 50) break;
      }
    } catch (err) {
      const status = err?.response?.status;
      const msg =
        err?.response?.data?.message?.message ||
        err?.response?.data?.message ||
        err?.message ||
        String(err);
      // Entité absente sur une extrémité : ne pas bloquer le reste du tick (ex. User).
      if (status === 400 && /inconnue|unknown/i.test(String(msg))) {
        summary.entities[entity] = {
          pulled: 0,
          applied: 0,
          skipped: 0,
          errors: 0,
          blocked: false,
          unsupported: true,
          detail: String(msg),
        };
        continue;
      }
      throw err;
    }

    summary.entities[entity] = {
      pulled,
      applied,
      skipped,
      errors,
      blocked,
      cursor: cursors[entity],
      ...(errorSamples.length ? { errorSamples } : {}),
    };
  }

  return summary;
}
