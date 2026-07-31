#Requires -Version 5.1
<#
  Prepare server-stack/ before dist:win:server:
  - export Docker images backend + sync-agent (offline mother machine)
  - inject SYNC_API_KEY from infra/docker/.env.server into defaults.env (bundled in exe)
#>
$ErrorActionPreference = 'Stop'

$DesktopRoot = Split-Path $PSScriptRoot -Parent
$RepoRoot = Split-Path (Split-Path $DesktopRoot -Parent) -Parent
$StackDir = Join-Path $DesktopRoot 'server-stack'
$ImagesDir = Join-Path $StackDir 'images'
$DefaultsFile = Join-Path $StackDir 'defaults.env'
$EnvServer = Join-Path $RepoRoot 'infra\docker\.env.server'

$BackendImage = 'northamerica-northeast1-docker.pkg.dev/eau-cascade/pos-backend/backend:latest'
$BackendBundle = 'eau-cascade/backend:bundle'
$SyncAgentBundle = 'eau-cascade/sync-agent:bundle'
$SyncAgentContext = Join-Path $RepoRoot 'apps\sync-agent'

New-Item -ItemType Directory -Path $ImagesDir -Force | Out-Null

function Test-IsPlaceholderKey([string] $Value) {
  if ([string]::IsNullOrWhiteSpace($Value)) { return $true }
  if ($Value.Length -lt 24) { return $true }
  return $Value -match 'remplace|change.?me|your.?key|xxx+|TODO|INSERT|example|placeholder'
}

$defaults = @(
  'REMOTE_API_URL=http://35.203.5.250',
  'SYNC_INTERVAL_MS=45000',
  'GCS_ASSETS_URI=gs://eau-cascade-assets/sync-assets'
)
if (-not (Test-Path -LiteralPath $EnvServer)) {
  throw 'infra/docker/.env.server manquant. Lancez d''abord: infra/scripts/gcp-provision-sync.ps1'
}
$syncLine = Get-Content $EnvServer | Where-Object { $_ -match '^\s*SYNC_API_KEY=\S+' } | Select-Object -First 1
if (-not $syncLine) {
  throw 'SYNC_API_KEY absente de infra/docker/.env.server (requis pour sync Remote).'
}
$syncKey = ($syncLine -split '=', 2)[1].Trim().Trim('"')
if (Test-IsPlaceholderKey $syncKey) {
  throw 'SYNC_API_KEY placeholder dans .env.server. Relancez: infra/scripts/gcp-provision-sync.ps1'
}
$defaults += "SYNC_API_KEY=$syncKey"
Set-Content -LiteralPath $DefaultsFile -Value ($defaults -join "`n") -Encoding UTF8
Write-Host 'defaults.env pret - SYNC_API_KEY sera dans l''exe Server (extraResources)'

$dockerOk = $false
try {
  & docker info 1>$null 2>$null
  if ($LASTEXITCODE -eq 0) { $dockerOk = $true }
} catch {
  $dockerOk = $false
}
if (-not $dockerOk) {
  Write-Warning 'Docker indisponible - images .tar non exportees. Le build Server necessite Docker.'
  if ($env:GITHUB_ACTIONS -eq 'true') {
    throw 'Docker requis pour dist:win:server en CI (images offline machine mere).'
  }
  exit 0
}

Write-Host "Pull backend $BackendImage ..."
docker pull $BackendImage
if ($LASTEXITCODE -ne 0) { throw 'docker pull backend a echoue' }
docker tag $BackendImage $BackendBundle
docker save -o (Join-Path $ImagesDir 'backend.tar') $BackendBundle
Write-Host 'backend.tar exporte'

Write-Host 'Pull postgres:16 (offline machine mere)...'
docker pull postgres:16
if ($LASTEXITCODE -ne 0) { throw 'docker pull postgres:16 a echoue' }
docker save -o (Join-Path $ImagesDir 'postgres.tar') postgres:16
Write-Host 'postgres.tar exporte'

Write-Host 'Build sync-agent...'
docker build -t $SyncAgentBundle $SyncAgentContext
if ($LASTEXITCODE -ne 0) { throw 'docker build sync-agent a echoue' }
docker save -o (Join-Path $ImagesDir 'sync-agent.tar') $SyncAgentBundle
Write-Host 'sync-agent.tar exporte'

Write-Host 'server-stack pret pour dist:win:server'
