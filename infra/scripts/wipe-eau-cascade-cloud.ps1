#Requires -Version 5.1
<#
.SYNOPSIS
  Vide Postgres sur la VM GCP eau-cascade (35.203.5.250) uniquement.

.DESCRIPTION
  À lancer depuis la machine DEV avec gcloud config pos-eau-cascade.
  PRÉREQUIS : sync-agent ARRÊTÉ sur la machine Server (sinon elle re-pousse les données).
#>
$ErrorActionPreference = 'Continue'

$Assert = Join-Path $PSScriptRoot 'assert-eau-cascade-gcp.ps1'
& $Assert

$project = (& gcloud config get-value project 2>$null | Out-String).Trim()
if ($project -ne 'eau-cascade') {
  throw "ABORT: project='$project' (attendu eau-cascade)"
}

Write-Host "PRÉREQUIS: sync-agent Server doit être arrêté." -ForegroundColor Yellow
Write-Host "Wipe cloud projet=$project VM=pos-api" -ForegroundColor Cyan

$localSh = Join-Path $env:TEMP 'wipe-eau-cascade-cloud.sh'
$bash = @'
#!/usr/bin/env bash
set -euo pipefail
cd /opt/pos
test -f .env.prod
test -f docker-compose.gcp.yml
if grep -Eiq 'pos-freres|pos-entrprise-israel|freres-basiles' docker-compose.gcp.yml .env.prod; then
  echo "ABORT: autre tenant détecté" >&2
  exit 2
fi
if docker compose version >/dev/null 2>&1; then COMPOSE=(docker compose); else COMPOSE=(docker-compose); fi
"${COMPOSE[@]}" -f docker-compose.gcp.yml --env-file .env.prod stop backend
docker exec pos_postgres_prod psql -U postgres -d pos_db -v ON_ERROR_STOP=1 -c 'DROP SCHEMA public CASCADE; CREATE SCHEMA public;'
"${COMPOSE[@]}" -f docker-compose.gcp.yml --env-file .env.prod up -d --force-recreate backend
for i in $(seq 1 45); do
  if out=$(curl -fsS http://127.0.0.1:3000/auth/setup-status); then
    echo "$out"
    echo "$out" | grep -q '"needsFirstUser":true' && echo CLOUD_OK && exit 0
    echo "Cloud non vide après wipe: $out" >&2
    exit 1
  fi
  sleep 3
done
docker logs pos_backend_prod --tail 40 >&2
exit 1
'@
[System.IO.File]::WriteAllText($localSh, ($bash -replace "`r`n", "`n"))

gcloud compute scp $localSh 'pos-api:/tmp/wipe-eau-cascade-cloud.sh' `
  --zone=northamerica-northeast1-a --project=eau-cascade
gcloud compute ssh pos-api `
  --zone=northamerica-northeast1-a --project=eau-cascade `
  --command='sudo bash /tmp/wipe-eau-cascade-cloud.sh && sudo rm -f /tmp/wipe-eau-cascade-cloud.sh'

Write-Host "OK cloud eau-cascade vide (needsFirstUser=true)." -ForegroundColor Green
Write-Host "Sur le Server: docker compose --env-file .env.server up -d sync-agent" -ForegroundColor Cyan
