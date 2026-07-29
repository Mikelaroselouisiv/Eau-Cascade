#!/usr/bin/env bash
# Déploie la stack GCP sur la VM (pull image + compose up).
# Appelé par .github/workflows/backend-gcp.yml après push Artifact Registry.
#
# Variables requises :
#   GCP_PROJECT_ID
# Optionnel :
#   GCP_VM_NAME (défaut pos-api), GCP_VM_ZONE (défaut northamerica-northeast1-a)
#   GCP_REMOTE_DIR (défaut /opt/pos)

set -euo pipefail

: "${GCP_PROJECT_ID:?GCP_PROJECT_ID requis}"

GCP_VM_NAME="${GCP_VM_NAME:-pos-api}"
GCP_VM_ZONE="${GCP_VM_ZONE:-northamerica-northeast1-a}"
REMOTE_DIR="${GCP_REMOTE_DIR:-/opt/pos}"
COMPOSE_LOCAL="infra/docker/docker-compose.gcp.yml"

if [[ ! -f "${COMPOSE_LOCAL}" ]]; then
  echo "Fichier introuvable: ${COMPOSE_LOCAL}" >&2
  exit 1
fi

echo "==> Deploy context"
echo "  PROJECT=${GCP_PROJECT_ID}"
echo "  VM=${GCP_VM_NAME}"
echo "  ZONE=${GCP_VM_ZONE}"

SCP_OPTS=(
  --zone="${GCP_VM_ZONE}"
  --project="${GCP_PROJECT_ID}"
  --tunnel-through-iap
  --quiet
  --scp-flag="-o StrictHostKeyChecking=no"
  --scp-flag="-o UserKnownHostsFile=/dev/null"
)
SSH_OPTS=(
  --zone="${GCP_VM_ZONE}"
  --project="${GCP_PROJECT_ID}"
  --tunnel-through-iap
  --quiet
  --ssh-flag="-o StrictHostKeyChecking=no"
  --ssh-flag="-o UserKnownHostsFile=/dev/null"
)

# Staging dans le home SSH (évite /tmp sticky-bit entre users CI vs local)
STAGE_COMPOSE='pos-docker-compose.gcp.yml'
STAGE_SCRIPT='pos-gcp-deploy-remote.sh'

echo "==> Copie ${COMPOSE_LOCAL} → ${GCP_VM_NAME}:~/${STAGE_COMPOSE}"
gcloud compute scp "${COMPOSE_LOCAL}" \
  "${GCP_VM_NAME}:${STAGE_COMPOSE}" \
  "${SCP_OPTS[@]}"

REMOTE_SCRIPT=$(cat <<'EOS'
set -euo pipefail
REMOTE_DIR="${REMOTE_DIR}"
STAGE_COMPOSE="${STAGE_COMPOSE}"
STAGE_SCRIPT="${STAGE_SCRIPT}"
mkdir -p "${REMOTE_DIR}"
cp "${STAGE_COMPOSE}" "${REMOTE_DIR}/docker-compose.gcp.yml"
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
if docker compose version >/dev/null 2>&1; then
  COMPOSE_CMD=(docker compose)
elif command -v docker-compose >/dev/null 2>&1; then
  COMPOSE_CMD=(docker-compose)
else
  echo 'docker compose introuvable' >&2
  exit 1
fi
"${COMPOSE_CMD[@]}" -f docker-compose.gcp.yml --env-file .env.prod pull backend
"${COMPOSE_CMD[@]}" -f docker-compose.gcp.yml --env-file .env.prod up -d --no-deps --force-recreate backend
"${COMPOSE_CMD[@]}" -f docker-compose.gcp.yml --env-file .env.prod ps
EOS
)

echo "==> Déploiement sur ${GCP_VM_NAME} (${GCP_VM_ZONE})"
# Résoudre le home distant du user SSH, puis écrire le script avec chemins absolus
REMOTE_HOME=$(gcloud compute ssh "${GCP_VM_NAME}" "${SSH_OPTS[@]}" --command='printf %s "$HOME"')
echo "  REMOTE_HOME=${REMOTE_HOME}"

{
  echo "export REMOTE_DIR='${REMOTE_DIR}'"
  echo "export STAGE_COMPOSE='${REMOTE_HOME}/${STAGE_COMPOSE}'"
  echo "export STAGE_SCRIPT='${REMOTE_HOME}/${STAGE_SCRIPT}'"
  printf '%s\n' "$REMOTE_SCRIPT"
} > /tmp/pos-gcp-deploy-remote.sh

gcloud compute scp /tmp/pos-gcp-deploy-remote.sh \
  "${GCP_VM_NAME}:${STAGE_SCRIPT}" \
  "${SCP_OPTS[@]}"

gcloud compute ssh "${GCP_VM_NAME}" \
  "${SSH_OPTS[@]}" \
  --command="sudo bash '${REMOTE_HOME}/${STAGE_SCRIPT}'"

echo "==> Déploiement GCP terminé"
