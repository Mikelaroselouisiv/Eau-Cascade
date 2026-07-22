/** API locale (machine mère / Docker Server). */
export const LOCAL_API_BASE_URL = 'http://localhost:3000';

/**
 * URL publique du backend Nest (GCP ou domaine) — édition Remote.
 * À modifier ici si l’IP ou le domaine change.
 * (Une variable `VITE_API_URL` surcharge encore cette valeur si elle est définie au build.)
 */
/** Port 80 via Nginx → Nest sur :3000 (voir infra/nginx/pos-api.conf). */
export const PUBLIC_API_BASE_URL = 'http://35.203.0.140';