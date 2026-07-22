#Requires -Version 5.1
<#
.SYNOPSIS
  Aligne SYNC_API_KEY (local Server + GCP) et redéploie la stack GCP.
#>
param(
  [string] $MonorepoRoot = '',
  [string] $VmName = 'pos-api',
  [string] $VmZone = 'northamerica-northeast1-a',
  [string] $ProjectId = 'pos-entrprise-israel',
  [string] $RemoteDir = '/opt/pos',
  [switch] $SkipDeploy
)

$ErrorActionPreference = 'Stop'

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot = if ($MonorepoRoot) {
  (Resolve-Path -LiteralPath $MonorepoRoot).Path
} else {
  (Resolve-Path -LiteralPath (Join-Path $ScriptDir '..\..')).Path
}

$DockerDir = Join-Path $RepoRoot 'infra\docker'
$EnvExample = Join-Path $DockerDir '.env.server.example'
$EnvServer = Join-Path $DockerDir '.env.server'
$ComposeGcp = Join-Path $DockerDir 'docker-compose.gcp.yml'

function New-RandomSecret {
  param([int] $ByteLength = 32)
  $bytes = New-Object byte[] $ByteLength
  [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
  -join ($bytes | ForEach-Object { '{0:x2}' -f $_ })
}

function Ensure-EnvKey {
  param([string] $FilePath, [string] $Key, [string] $DefaultValue)
  $lines = if (Test-Path $FilePath) { @(Get-Content -LiteralPath $FilePath) } else { @() }
  $pattern = "^\s*$([regex]::Escape($Key))\s*="
  $existing = $lines | Where-Object { $_ -match $pattern } | Select-Object -First 1
  if ($existing) {
    return ($existing -split '=', 2)[1].Trim().Trim('"')
  }
  $lines += "$Key=$DefaultValue"
  Set-Content -LiteralPath $FilePath -Value ($lines -join "`n") -Encoding UTF8
  return $DefaultValue
}

Write-Host '==> SYNC_API_KEY locale (.env.server)' -ForegroundColor Cyan
if (-not (Test-Path $EnvServer)) {
  Copy-Item -LiteralPath $EnvExample -Destination $EnvServer
}
$syncKey = Ensure-EnvKey -FilePath $EnvServer -Key 'SYNC_API_KEY' -DefaultValue (New-RandomSecret)
Write-Host 'SYNC_API_KEY prête dans .env.server'

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
$remoteCompose = '/tmp/docker-compose.gcp.yml'
gcloud compute scp $ComposeGcp "${VmName}:${remoteCompose}" --zone=$VmZone --project=$ProjectId

$deployCmd = @'
#!/usr/bin/env bash
set -euo pipefail
REMOTE_DIR='__REMOTE_DIR__'
sudo cp /tmp/docker-compose.gcp.yml "$REMOTE_DIR/docker-compose.gcp.yml"
cd "$REMOTE_DIR"
if command -v gcloud >/dev/null 2>&1; then
  sudo gcloud auth configure-docker northamerica-northeast1-docker.pkg.dev --quiet || true
fi
COMPOSE_CMD="docker-compose"
if ! command -v docker-compose >/dev/null 2>&1; then
  COMPOSE_CMD="docker compose"
fi
sudo $COMPOSE_CMD -f docker-compose.gcp.yml --env-file .env.prod pull
sudo $COMPOSE_CMD -f docker-compose.gcp.yml --env-file .env.prod up -d --force-recreate backend
sudo $COMPOSE_CMD -f docker-compose.gcp.yml ps
'@ -replace '__REMOTE_DIR__', $RemoteDir

$deploySh = Join-Path $env:TEMP "pos-deploy-$([guid]::NewGuid().ToString('n')).sh"
[System.IO.File]::WriteAllText($deploySh, ($deployCmd -replace "`r`n", "`n"))
gcloud compute scp $deploySh "${VmName}:/tmp/pos-deploy.sh" --zone=$VmZone --project=$ProjectId
gcloud compute ssh $VmName --zone=$VmZone --project=$ProjectId --command="bash /tmp/pos-deploy.sh && rm -f /tmp/pos-deploy.sh"
Remove-Item -LiteralPath $deploySh -Force -ErrorAction SilentlyContinue

Write-Host '==> Terminé' -ForegroundColor Green
