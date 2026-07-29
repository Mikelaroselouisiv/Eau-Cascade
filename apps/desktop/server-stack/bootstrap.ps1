#Requires -Version 5.1
<#
  Bootstrap machine mère — appelé automatiquement par l'installateur Server au 1er lancement.
  Prérequis : dossier server-stack avec docker-compose.yml, images/*.tar, defaults.env
#>
param(
  [Parameter(Mandatory = $true)]
  [string] $StackDir
)

$ErrorActionPreference = 'Stop'
$StackDir = (Resolve-Path -LiteralPath $StackDir).Path
$ComposeFile = Join-Path $StackDir 'docker-compose.yml'
$EnvFile = Join-Path $StackDir '.env.server'
$DefaultsFile = Join-Path $StackDir 'defaults.env'
$ImagesDir = Join-Path $StackDir 'images'
$StateFile = Join-Path $StackDir '.bootstrap-done'
$TaskName = 'POS-Eau-Cascade-Server-Stack'
$StartScript = Join-Path $StackDir 'stack-start.ps1'

function Write-Step([string]$Message) {
  Write-Host "==> $Message" -ForegroundColor Cyan
}

function New-RandomSecret([int]$ByteLength = 32) {
  $bytes = New-Object byte[] $ByteLength
  [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
  -join ($bytes | ForEach-Object { '{0:x2}' -f $_ })
}

function Test-DockerReady {
  if (-not (Get-Command docker -ErrorAction SilentlyContinue)) { return $false }
  docker info 2>$null | Out-Null
  return $LASTEXITCODE -eq 0
}

function Install-DockerDesktop {
  if (Test-DockerReady) { return }
  if (-not (Get-Command winget -ErrorAction SilentlyContinue)) {
    throw 'Docker requis. Installez Docker Desktop manuellement puis relancez l''application.'
  }
  Write-Step 'Installation de Docker Desktop...'
  winget install -e --id Docker.DockerDesktop --accept-package-agreements --accept-source-agreements
  $deadline = (Get-Date).AddMinutes(5)
  while ((Get-Date) -lt $deadline) {
    if (Test-DockerReady) { return }
    Start-Sleep -Seconds 5
  }
  throw 'Docker Desktop installé mais pas prêt. Redémarrez le PC puis relancez l''application.'
}

function Ensure-EnvFile {
  if (Test-Path -LiteralPath $EnvFile) { return }

  $lines = @()
  if (Test-Path -LiteralPath $DefaultsFile) {
    $lines += Get-Content -LiteralPath $DefaultsFile
  }

  $map = @{}
  foreach ($line in $lines) {
    if ($line -match '^\s*([^#=]+)=(.*)$') {
      $map[$Matches[1].Trim()] = $Matches[2].Trim()
    }
  }

  $map['POSTGRES_PASSWORD'] = New-RandomSecret -ByteLength 24
  $map['JWT_SECRET'] = New-RandomSecret -ByteLength 48
  if (-not $map.ContainsKey('SYNC_API_KEY') -or -not $map['SYNC_API_KEY']) {
    $map['SYNC_API_KEY'] = New-RandomSecret -ByteLength 32
  }

  $out = foreach ($key in $map.Keys) { "$key=$($map[$key])" }
  Set-Content -LiteralPath $EnvFile -Value ($out -join "`n") -Encoding UTF8
  Write-Step 'Secrets locaux générés (.env.server)'
}

function Import-BundledImages {
  if (-not (Test-Path -LiteralPath $ImagesDir)) { return }
  $tars = Get-ChildItem -LiteralPath $ImagesDir -Filter '*.tar' -File -ErrorAction SilentlyContinue
  foreach ($tar in $tars) {
    Write-Step "Chargement image $($tar.Name)..."
    docker load -i $tar.FullName | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "docker load a échoué pour $($tar.Name)" }
  }
}

function Test-LocalApi {
  try {
    $response = Invoke-WebRequest -Uri 'http://127.0.0.1:3000/auth/setup-status' -UseBasicParsing -TimeoutSec 3
    return $response.StatusCode -eq 200
  } catch {
    return $false
  }
}

function Test-PortInUse([int]$Port) {
  $conn = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
  return $null -ne $conn
}

function Assert-PortsFree {
  if (-not (Test-PortInUse -Port 3000)) { return }
  if (Test-LocalApi) {
    Write-Step 'API locale déjà active sur le port 3000'
    return
  }
  throw "Le port 3000 est déjà utilisé (API locale). Arrêtez l'autre service ou fermez l'ancienne instance du POS, puis relancez."
}

function Start-Stack {
  Assert-PortsFree
  Write-Step 'Démarrage Postgres + API + sync-agent...'
  Push-Location $StackDir
  try {
    docker compose -f $ComposeFile --env-file $EnvFile up -d
    if ($LASTEXITCODE -ne 0) { throw "docker compose up a échoué (code $LASTEXITCODE)" }
  } finally {
    Pop-Location
  }
}

function Write-StackStartScript {
  @"
#Requires -Version 5.1
`$ErrorActionPreference = 'Stop'
`$StackDir = '$StackDir'
`$ComposeFile = Join-Path `$StackDir 'docker-compose.yml'
`$EnvFile = Join-Path `$StackDir '.env.server'
`$deadline = (Get-Date).AddMinutes(3)
while ((Get-Date) -lt `$deadline) {
  docker info 2>`$null | Out-Null
  if (`$LASTEXITCODE -eq 0) { break }
  Start-Sleep -Seconds 3
}
Set-Location `$StackDir
docker compose -f `$ComposeFile --env-file `$EnvFile up -d
"@ | Set-Content -LiteralPath $StartScript -Encoding UTF8
}

function Register-ScheduledTask {
  $existing = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
  if ($existing) { return }
  Write-StackStartScript
  $action = New-ScheduledTaskAction -Execute 'powershell.exe' `
    -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$StartScript`""
  $trigger = New-ScheduledTaskTrigger -AtLogon -User $env:USERNAME
  $trigger.Delay = 'PT1M'
  $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable
  try {
    Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings `
      -Description 'Stack POS Server (Postgres + API locale)' | Out-Null
  } catch {
    Write-Warning 'Tâche planifiée non créée (droits admin). La stack tourne quand même.'
  }
}

if (Test-Path -LiteralPath $StateFile) {
  if (Test-DockerReady) {
    Import-BundledImages
    Push-Location $StackDir
    try {
      docker compose -f $ComposeFile --env-file $EnvFile up -d 2>$null | Out-Null
    } finally {
      Pop-Location
    }
  }
  exit 0
}

# Reprise après échec partiel : .env existe, stack déjà opérationnelle
if ((Test-Path -LiteralPath $EnvFile) -and (Test-LocalApi)) {
  if (Test-DockerReady) {
    Push-Location $StackDir
    try { docker compose -f $ComposeFile --env-file $EnvFile up -d 2>$null | Out-Null } finally { Pop-Location }
  }
  Set-Content -LiteralPath $StateFile -Value (Get-Date).ToString('o') -Encoding UTF8
  exit 0
}

Write-Step 'Configuration machine mère (premier lancement)'
Install-DockerDesktop
Ensure-EnvFile
Import-BundledImages
Start-Stack
Register-ScheduledTask
Set-Content -LiteralPath $StateFile -Value (Get-Date).ToString('o') -Encoding UTF8
Write-Step 'Machine mère prête — API http://localhost:3000'
