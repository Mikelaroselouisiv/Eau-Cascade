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
 * Pull deltas from `from` and apply them on `to`.
 * Curseur avancé même si certaines lignes échouent (poison pill) —
 * sinon une seule Sale cassée bloque tout l’historique.
 * Relancer l’agent (curseurs mémoire) rejoue depuis epoch pour les ratés.
 */
export async function replicateDirection({
  from,
  to,
  cursors,
  sourceNodeId,
  label,
}) {
  const summary = { label, entities: {} };
  const maxPages = Number(process.env.SYNC_MAX_PAGES_PER_ENTITY || 100);

  for (const entity of ENTITY_ORDER) {
    let since = cursors[entity] || '1970-01-01T00:00:00.000Z';
    let pulled = 0;
    let applied = 0;
    let skipped = 0;
    let errors = 0;
    const errorSamples = [];
    let pages = 0;
    let partialErrors = false;

    for (;;) {
      pages += 1;
      let data;
      try {
        const res = await from.get('/sync/pull', {
          params: { entity, since, take: 200 },
        });
        data = res.data;
      } catch (err) {
        errors += 1;
        partialErrors = true;
        errorSamples.push(`pull: ${err?.message || 'error'}`);
        break;
      }
      const records = data.records || [];
      if (records.length === 0) {
        if (data.nextCursor) cursors[entity] = data.nextCursor;
        break;
      }

      pulled += records.length;
      let pushRes;
      try {
        pushRes = await to.post('/sync/push', {
          entity,
          sourceNodeId,
          records,
        });
      } catch (err) {
        errors += 1;
        partialErrors = true;
        errorSamples.push(`push: ${err?.message || 'error'}`);
        break;
      }
      const batchApplied = pushRes.data?.applied ?? 0;
      const batchSkipped = pushRes.data?.skipped ?? 0;
      const batchErrors = pushRes.data?.errors ?? 0;
      applied += batchApplied;
      skipped += batchSkipped;
      errors += batchErrors;

      if (batchErrors > 0) {
        partialErrors = true;
        const failed = (pushRes.data?.results || [])
          .filter((r) => r.action === 'error')
          .slice(0, 5)
          .map((r) => `${r.uuid}: ${r.error || 'error'}`);
        errorSamples.push(...failed);
      }

      // Toujours avancer : les erreurs individuelles sont loguées, pas bloquantes.
      since = data.nextCursor || records[records.length - 1]?.updatedAt || since;
      cursors[entity] = since;

      if (records.length < 200 || pages >= maxPages) break;
    }

    summary.entities[entity] = {
      pulled,
      applied,
      skipped,
      errors,
      partialErrors,
      cursor: cursors[entity],
      ...(errorSamples.length ? { errorSamples } : {}),
    };
  }

  return summary;
}
