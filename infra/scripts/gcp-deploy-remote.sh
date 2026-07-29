#!/usr/bin/env bash
# Déploie la stack GCP sur la VM (pull image + compose up).
# Appelé par .github/workflows/backend-gcp.yml après push Artifact Registry.
#
# Variables requises :
#   GCP_PROJECT_ID, GCP_VM_NAME, GCP_VM_ZONE
# Optionnel :
#   GCP_REMOTE_DIR (défaut /opt/pos)

set -euo pipefail

: "${GCP_PROJECT_ID:?GCP_PROJECT_ID requis}"
: "${GCP_VM_NAME:?GCP_VM_NAME requis}"
: "${GCP_VM_ZONE:?GCP_VM_ZONE requis}"

REMOTE_DIR="${GCP_REMOTE_DIR:-/opt/pos}"
COMPOSE_LOCAL="infra/docker/docker-compose.gcp.yml"

if [[ ! -f "${COMPOSE_LOCAL}" ]]; then
  echo "Fichier introuvable: ${COMPOSE_LOCAL}" >&2
  exit 1
fi

SSH_OPTS=(--zone="${GCP_VM_ZONE}" --project="${GCP_PROJECT_ID}" --tunnel-through-iap)

echo "==> Copie ${COMPOSE_LOCAL} → ${GCP_VM_NAME}:${REMOTE_DIR}/docker-compose.gcp.yml"
gcloud compute scp "${COMPOSE_LOCAL}" \
  "${GCP_VM_NAME}:/tmp/docker-compose.gcp.yml" \
  "${SSH_OPTS[@]}"

# Script remote exécuté entièrement en root (/opt/pos est root:docker 750).
REMOTE_SCRIPT=$(cat <<'EOS'
set -euo pipefail
REMOTE_DIR="${REMOTE_DIR}"
mkdir -p "${REMOTE_DIR}"
cp /tmp/docker-compose.gcp.yml "${REMOTE_DIR}/docker-compose.gcp.yml"
cd "${REMOTE_DIR}"
if [[ ! -f .env.prod ]]; then
  echo "Erreur: .env.prod manquant dans ${REMOTE_DIR}" >&2
  exit 1
fi
TOKEN=$(curl -s -H 'Metadata-Flavor: Google' \
  'http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token' \
  | python3 -c 'import sys,json; print(json.load(sys.stdin)["access_token"])')
AUTH=$(printf 'oauth2accesstoken:%s' "$TOKEN" | base64 -w0)
mkdir -p /root/.docker
printf '%s\n' "{\"auths\":{\"northamerica-northeast1-docker.pkg.dev\":{\"auth\":\"$AUTH\"}}}" > /root/.docker/config.json
# Préférer Compose V2 (plugin) — V1 (1.29) casse avec Docker Engine récent (ContainerConfig).
if docker compose version >/dev/null 2>&1; then
  COMPOSE_CMD=(docker compose)
elif command -v docker-compose >/dev/null 2>&1; then
  COMPOSE_CMD=(docker-compose)
else
  echo 'docker compose introuvable' >&2
  exit 1
fi
"${COMPOSE_CMD[@]}" -f docker-compose.gcp.yml --env-file .env.prod pull backend
# --no-deps : ne pas recréer postgres (évite KeyError ContainerConfig + conserve les données)
"${COMPOSE_CMD[@]}" -f docker-compose.gcp.yml --env-file .env.prod up -d --no-deps --force-recreate backend
"${COMPOSE_CMD[@]}" -f docker-compose.gcp.yml ps
EOS
)

# Inject REMOTE_DIR into the remote environment.
echo "==> Déploiement sur ${GCP_VM_NAME} (${GCP_VM_ZONE})"
printf '%s\n' "export REMOTE_DIR='${REMOTE_DIR}'" "$REMOTE_SCRIPT" > /tmp/pos-gcp-deploy-remote.sh
gcloud compute scp /tmp/pos-gcp-deploy-remote.sh \
  "${GCP_VM_NAME}:/tmp/pos-gcp-deploy-remote.sh" \
  "${SSH_OPTS[@]}"
gcloud compute ssh "${GCP_VM_NAME}" \
  "${SSH_OPTS[@]}" \
  --command="sudo bash /tmp/pos-gcp-deploy-remote.sh"

echo "==> Déploiement GCP terminé"

# retrigger 2026-07-28T22:27:31.8162981-04:00

