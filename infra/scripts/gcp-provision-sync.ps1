#Requires -Version 5.1
<#
.SYNOPSIS
  Aligne SYNC_API_KEY (local Server + GCP) et redéploie la stack GCP.
  Remplace les placeholders (remplace_par_…) par une vraie clé.
#>
param(
  [string] $MonorepoRoot = '',
  [string] $VmName = 'pos-api',
  [string] $VmZone = 'northamerica-northeast1-a',
  [string] $ProjectId = 'eau-cascade',
  [string] $RemoteDir = '/opt/pos',
  [switch] $SkipDeploy,
  [switch] $ForceNewKey
)

$ErrorActionPreference = 'Stop'

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot = if ($MonorepoRoot) {
  (Resolve-Path -LiteralPath $MonorepoRoot).Path
} else {
  (Resolve-Path -LiteralPath (Join-Path $ScriptDir '..\..')).Path
}

$AssertScript = Join-Path $ScriptDir 'assert-eau-cascade-gcp.ps1'
if (Test-Path -LiteralPath $AssertScript) {
  & $AssertScript
}

$DockerDir = Join-Path $RepoRoot 'infra\docker'
$EnvExample = Join-Path $DockerDir '.env.server.example'
$EnvServer = Join-Path $DockerDir '.env.server'
$ComposeGcp = Join-Path $DockerDir 'docker-compose.gcp.yml'
$DefaultsFile = Join-Path $RepoRoot 'apps\desktop\server-stack\defaults.env'

function New-RandomSecret {
  param([int] $ByteLength = 32)
  $bytes = New-Object byte[] $ByteLength
  [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
  -join ($bytes | ForEach-Object { '{0:x2}' -f $_ })
}

function Test-IsPlaceholderKey([string] $Value) {
  if ([string]::IsNullOrWhiteSpace($Value)) { return $true }
  if ($Value.Length -lt 24) { return $true }
  return $Value -match 'remplace|change.?me|your.?key|xxx+|TODO|INSERT|example|placeholder'
}

function Set-EnvKey {
  param([string] $FilePath, [string] $Key, [string] $Value)
  $lines = if (Test-Path $FilePath) { @(Get-Content -LiteralPath $FilePath) } else { @() }
  $pattern = "^\s*$([regex]::Escape($Key))\s*="
  $found = $false
  $out = foreach ($line in $lines) {
    if ($line -match $pattern) {
      $found = $true
      "$Key=$Value"
    } else {
      $line
    }
  }
  if (-not $found) { $out += "$Key=$Value" }
  Set-Content -LiteralPath $FilePath -Value ($out -join "`n") -Encoding UTF8
}

function Get-EnvKey {
  param([string] $FilePath, [string] $Key)
  if (-not (Test-Path $FilePath)) { return $null }
  $line = Get-Content -LiteralPath $FilePath | Where-Object { $_ -match "^\s*$([regex]::Escape($Key))\s*=" } | Select-Object -First 1
  if (-not $line) { return $null }
  return ($line -split '=', 2)[1].Trim().Trim('"')
}

Write-Host '==> SYNC_API_KEY locale (.env.server)' -ForegroundColor Cyan
if (-not (Test-Path $EnvServer)) {
  if (-not (Test-Path $EnvExample)) {
    throw "Fichier manquant: $EnvExample"
  }
  Copy-Item -LiteralPath $EnvExample -Destination $EnvServer
}

$existing = Get-EnvKey -FilePath $EnvServer -Key 'SYNC_API_KEY'
if ($ForceNewKey -or (Test-IsPlaceholderKey $existing)) {
  $syncKey = New-RandomSecret -ByteLength 32
  Set-EnvKey -FilePath $EnvServer -Key 'SYNC_API_KEY' -Value $syncKey
  Write-Host 'Nouvelle SYNC_API_KEY generee (placeholder / ForceNewKey)'
} else {
  $syncKey = $existing
  Write-Host 'SYNC_API_KEY existante reutilisee'
}

# Embarquer immédiatement dans defaults.env (installateur Server)
$defaults = @(
  'REMOTE_API_URL=http://35.203.5.250',
  'SYNC_INTERVAL_MS=45000',
  'GCS_ASSETS_URI=gs://eau-cascade-assets/sync-assets',
  "SYNC_API_KEY=$syncKey"
)
$defaultsDir = Split-Path -Parent $DefaultsFile
New-Item -ItemType Directory -Path $defaultsDir -Force | Out-Null
Set-Content -LiteralPath $DefaultsFile -Value ($defaults -join "`n") -Encoding UTF8
Write-Host "defaults.env prêt pour dist:win:server ($DefaultsFile)"

Write-Host '==> SYNC_API_KEY GCP' -ForegroundColor Cyan
$remoteSh = @"
#!/usr/bin/env bash
set -euo pipefail
cd '$RemoteDir'
touch .env.prod
if grep -q '^SYNC_API_KEY=' .env.prod; then
  sed -i 's/^SYNC_API_KEY=.*/SYNC_API_KEY=$syncKey/' .env.prod
else
  echo "SYNC_API_KEY=$syncKey" >> .env.prod
fi
chmod 600 .env.prod
echo done
"@
$localSh = Join-Path $env:TEMP "pos-sync-env-$([guid]::NewGuid().ToString('n')).sh"
[System.IO.File]::WriteAllText($localSh, ($remoteSh -replace "`r`n", "`n"))
gcloud compute scp $localSh "${VmName}:/tmp/pos-sync-env.sh" --zone=$VmZone --project=$ProjectId
gcloud compute ssh $VmName --zone=$VmZone --project=$ProjectId --command="sudo bash /tmp/pos-sync-env.sh && rm -f /tmp/pos-sync-env.sh"
Remove-Item -LiteralPath $localSh -Force -ErrorAction SilentlyContinue
Write-Host 'SYNC_API_KEY alignée sur la VM GCP'

if ($SkipDeploy) { exit 0 }

Write-Host '==> Déploiement GCP' -ForegroundColor Cyan
gcloud compute ssh $VmName --zone=$VmZone --project=$ProjectId --command="sudo rm -f /tmp/docker-compose.gcp.yml /tmp/pos-deploy.sh"
$remoteCompose = '/tmp/docker-compose.gcp.yml'
gcloud compute scp $ComposeGcp "${VmName}:${remoteCompose}" --zone=$VmZone --project=$ProjectId

$deployCmd = @'
#!/usr/bin/env bash
set -euo pipefail
REMOTE_DIR='__REMOTE_DIR__'
sudo cp /tmp/docker-compose.gcp.yml "$REMOTE_DIR/docker-compose.gcp.yml"
cd "$REMOTE_DIR"
if command -v gcloud >/dev/null 2>&1; then
  gcloud auth configure-docker northamerica-northeast1-docker.pkg.dev --quiet || true
fi
if docker compose version >/dev/null 2>&1; then
  COMPOSE=(docker compose)
elif command -v docker-compose >/dev/null 2>&1; then
  COMPOSE=(docker-compose)
else
  echo "No docker compose found" >&2
  exit 1
fi
"${COMPOSE[@]}" -f docker-compose.gcp.yml --env-file .env.prod pull backend
"${COMPOSE[@]}" -f docker-compose.gcp.yml --env-file .env.prod up -d --no-deps --force-recreate backend
"${COMPOSE[@]}" -f docker-compose.gcp.yml ps
rm -f /tmp/docker-compose.gcp.yml
'@ -replace '__REMOTE_DIR__', $RemoteDir

$deploySh = Join-Path $env:TEMP "pos-deploy-$([guid]::NewGuid().ToString('n')).sh"
[System.IO.File]::WriteAllText($deploySh, ($deployCmd -replace "`r`n", "`n"))
gcloud compute scp $deploySh "${VmName}:/tmp/pos-deploy.sh" --zone=$VmZone --project=$ProjectId
gcloud compute ssh $VmName --zone=$VmZone --project=$ProjectId --command="sudo bash /tmp/pos-deploy.sh && sudo rm -f /tmp/pos-deploy.sh"
Remove-Item -LiteralPath $deploySh -Force -ErrorAction SilentlyContinue

Write-Host '==> Terminé — rebuild Server (npm run dist:win:server) pour embarquer la clé dans l''exe' -ForegroundColor Green
