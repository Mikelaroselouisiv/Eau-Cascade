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
COMPOSE_REMOTE="${REMOTE_DIR}/docker-compose.gcp.yml"

if [[ ! -f "${COMPOSE_LOCAL}" ]]; then
  echo "Fichier introuvable: ${COMPOSE_LOCAL}" >&2
  exit 1
fi

# IAP : le SA GitHub Actions n’a souvent pas d’IP publique SSH ouverte.
SSH_OPTS=(--zone="${GCP_VM_ZONE}" --project="${GCP_PROJECT_ID}" --tunnel-through-iap)

echo "==> Copie ${COMPOSE_LOCAL} → ${GCP_VM_NAME}:${COMPOSE_REMOTE}"
gcloud compute scp "${COMPOSE_LOCAL}" \
  "${GCP_VM_NAME}:/tmp/docker-compose.gcp.yml" \
  "${SSH_OPTS[@]}"

echo "==> Déploiement sur ${GCP_VM_NAME} (${GCP_VM_ZONE})"
gcloud compute ssh "${GCP_VM_NAME}" \
  "${SSH_OPTS[@]}" \
  --command="set -euo pipefail
    REMOTE_DIR='${REMOTE_DIR}'
    sudo mkdir -p \"\${REMOTE_DIR}\"
    sudo cp /tmp/docker-compose.gcp.yml \"\${REMOTE_DIR}/docker-compose.gcp.yml\"
    cd \"\${REMOTE_DIR}\"
    if [[ ! -f .env.prod ]]; then
      echo 'Erreur: .env.prod manquant dans '\${REMOTE_DIR} >&2
      exit 1
    fi
    # Auth Artifact Registry via token metadata (VM SA) — gcloud n'est pas toujours installé
    TOKEN=\$(curl -s -H 'Metadata-Flavor: Google' \
      'http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token' \
      | python3 -c 'import sys,json; print(json.load(sys.stdin)[\"access_token\"])')
    AUTH=\$(printf 'oauth2accesstoken:%s' \"\$TOKEN\" | base64 -w0)
    sudo mkdir -p /root/.docker
    printf '%s\n' \"{\\\"auths\\\":{\\\"northamerica-northeast1-docker.pkg.dev\\\":{\\\"auth\\\":\\\"\$AUTH\\\"}}}\" | sudo tee /root/.docker/config.json >/dev/null
    COMPOSE_CMD=docker-compose
    if ! command -v docker-compose >/dev/null 2>&1; then COMPOSE_CMD='docker compose'; fi
    sudo \$COMPOSE_CMD -f docker-compose.gcp.yml --env-file .env.prod pull
    sudo \$COMPOSE_CMD -f docker-compose.gcp.yml --env-file .env.prod up -d --force-recreate backend
    sudo \$COMPOSE_CMD -f docker-compose.gcp.yml ps"

echo "==> Déploiement GCP terminé"
