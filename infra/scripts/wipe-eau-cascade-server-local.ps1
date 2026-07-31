#Requires -Version 5.1
<#
.SYNOPSIS
  Nettoie la base Postgres de la machine mère Server (Eau Cascade) — source de vérité.

.DESCRIPTION
  À exécuter SUR le PC Server (pas sur la machine de développement).
  1) Arrête sync-agent (évite de recontaminer le cloud pendant le wipe)
  2) Vide le schéma public de pos_db local
  3) Recrée le backend (prisma migrate deploy) — sync-agent reste ARRÊTÉ

  Ensuite, depuis la machine DEV (gcloud pos-eau-cascade) :
    wipe cloud GCP → puis sur ce Server : docker compose up -d sync-agent
  Puis créer le premier administrateur dans l’app Server.

.PARAMETER StackDir
  Dossier server-stack. Défaut : ProgramData\POS Eau Cascade\server-stack
#>
param(
  [string] $StackDir = ''
)

$ErrorActionPreference = 'Stop'

function Write-Step([string]$Message) {
  Write-Host "==> $Message" -ForegroundColor Cyan
}

if (-not $StackDir) {
  $StackDir = Join-Path $env:ProgramData 'POS Eau Cascade\server-stack'
}

if (-not (Test-Path -LiteralPath $StackDir)) {
  throw "Stack Server introuvable: $StackDir — lancez d’abord l’app Server une fois, ou passez -StackDir."
}

$ComposeFile = Join-Path $StackDir 'docker-compose.yml'
$EnvFile = Join-Path $StackDir '.env.server'
if (-not (Test-Path -LiteralPath $ComposeFile)) { throw "docker-compose.yml manquant dans $StackDir" }
if (-not (Test-Path -LiteralPath $EnvFile)) { throw ".env.server manquant dans $StackDir" }

# Garde légère : refuse si .env pointe encore Frères
$envText = Get-Content -LiteralPath $EnvFile -Raw -ErrorAction SilentlyContinue
if ($envText -match 'freres|bazile|34\.118\.154\.220|pos-freres') {
  throw "ABORT: .env.server semble pointer vers Frères Baziles. Corrigez REMOTE_API_URL / GCS / SYNC avant wipe."
}

Write-Host ""
Write-Host "Machine : $env:COMPUTERNAME" -ForegroundColor Yellow
Write-Host "Stack   : $StackDir" -ForegroundColor Yellow
Write-Host "Ceci efface TOUTE la base locale Server Eau Cascade." -ForegroundColor Yellow
Write-Host ""

Write-Step 'Arrêt sync-agent (obligatoire)'
Push-Location $StackDir
try {
  docker compose -f $ComposeFile --env-file $EnvFile stop sync-agent
  docker stop pos_sync_agent 2>$null | Out-Null

  Write-Step 'Arrêt backend (pendant le DROP SCHEMA)'
  docker compose -f $ComposeFile --env-file $EnvFile stop backend

  Write-Step 'Postgres doit tourner'
  docker compose -f $ComposeFile --env-file $EnvFile up -d postgres
  $deadline = (Get-Date).AddMinutes(2)
  do {
    docker exec pos_postgres_server pg_isready -U postgres -d pos_db 2>$null | Out-Null
    if ($LASTEXITCODE -eq 0) { break }
    Start-Sleep -Seconds 2
  } while ((Get-Date) -lt $deadline)
  if ($LASTEXITCODE -ne 0) { throw 'Postgres local non prêt (pos_postgres_server).' }

  Write-Step 'DROP SCHEMA public CASCADE (base locale Server)'
  $sql = "DROP SCHEMA public CASCADE; CREATE SCHEMA public;"
  $sql | docker exec -i pos_postgres_server psql -U postgres -d pos_db -v ON_ERROR_STOP=1
  if ($LASTEXITCODE -ne 0) { throw 'Échec DROP SCHEMA local.' }

  Write-Step 'Recréation backend (migrate) — sync-agent reste arrêté'
  docker compose -f $ComposeFile --env-file $EnvFile up -d --force-recreate --no-deps backend

  Write-Step 'Attente API locale'
  $ready = $false
  $deadline = (Get-Date).AddMinutes(3)
  while ((Get-Date) -lt $deadline) {
    try {
      $r = Invoke-RestMethod -Uri 'http://127.0.0.1:3000/auth/setup-status' -TimeoutSec 3
      if ($r.needsFirstUser -eq $true) { $ready = $true; break }
      if ($r.needsFirstUser -eq $false) {
        throw 'Base locale non vide après wipe (needsFirstUser=false). Relancez le script.'
      }
    } catch {
      if ("$_" -match 'non vide') { throw }
    }
    Start-Sleep -Seconds 3
  }
  if (-not $ready) { throw 'API locale non prête ou wipe incomplet.' }

  # Double-check sync still down
  docker compose -f $ComposeFile --env-file $EnvFile stop sync-agent 2>$null | Out-Null
} finally {
  Pop-Location
}

Write-Host ""
Write-Host "OK — base Server locale vide (needsFirstUser=true), sync-agent ARRÊTÉ." -ForegroundColor Green
Write-Host ""
Write-Host "Étapes suivantes :" -ForegroundColor Cyan
Write-Host "  1) Sur la machine DEV (ce repo) : wipe cloud GCP eau-cascade"
Write-Host "     powershell -ExecutionPolicy Bypass -File infra/scripts/wipe-eau-cascade-cloud.ps1"
Write-Host "  2) Sur CE Server : redémarrer le sync"
Write-Host "     cd `"$StackDir`""
Write-Host "     docker compose --env-file .env.server up -d sync-agent"
Write-Host "  3) Ouvrir l’app Server → créer le premier administrateur"
Write-Host "  4) Attendre ~1 min → Remote / mobile utilisent le cloud (plus de 1er admin)"
Write-Host ""
