#Requires -Version 5.1
<#
.SYNOPSIS
  Bootstrap machine mère (édition Server) : Docker, secrets, pull image GCP, stack locale, tâche Windows.

.DESCRIPTION
  1. Vérifie / installe Docker Desktop (winget)
  2. Crée infra/docker/.env.server avec secrets aléatoires si absent
  3. Authentifie Docker vers Artifact Registry (gcloud)
  4. docker compose pull + up (Postgres MASTER + API localhost:3000)
  5. Enregistre une tâche planifiée au logon pour redémarrer la stack

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File infra/scripts/bootstrap-server.ps1
#>
param(
  [switch] $SkipDockerInstall,
  [switch] $SkipScheduledTask,
  [string] $MonorepoRoot = ''
)

$ErrorActionPreference = 'Stop'

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot = if ($MonorepoRoot) {
  (Resolve-Path -LiteralPath $MonorepoRoot).Path
} else {
  (Resolve-Path -LiteralPath (Join-Path $ScriptDir '..\..')).Path
}

$DockerDir = Join-Path $RepoRoot 'infra\docker'
$ComposeFile = Join-Path $DockerDir 'docker-compose.server.yml'
$EnvExample = Join-Path $DockerDir '.env.server.example'
$EnvFile = Join-Path $DockerDir '.env.server'
$StartScript = Join-Path $ScriptDir 'server-stack-start.ps1'
$GcpRegistry = 'northamerica-northeast1-docker.pkg.dev'
$TaskName = 'POS-Eau-Cascade-Server-Stack'

function Write-Step {
  param([string] $Message)
  Write-Host "`n==> $Message" -ForegroundColor Cyan
}

function New-RandomSecret {
  param([int] $ByteLength = 36)
  $bytes = New-Object byte[] $ByteLength
  [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
  [Convert]::ToBase64String($bytes) -replace '[+/=]', 'x'
}

function Test-DockerReady {
  if (-not (Get-Command docker -ErrorAction SilentlyContinue)) { return $false }
  & docker info 2>$null | Out-Null
  return $LASTEXITCODE -eq 0
}

function Install-DockerDesktopIfNeeded {
  if (Test-DockerReady) {
    Write-Host 'Docker est déjà disponible.'
    return
  }

  if ($SkipDockerInstall) {
    throw 'Docker est requis. Installez Docker Desktop ou relancez sans -SkipDockerInstall.'
  }

  if (-not (Get-Command winget -ErrorAction SilentlyContinue)) {
    throw 'Docker absent et winget indisponible. Installez Docker Desktop : https://docs.docker.com/desktop/setup/install/windows-install/'
  }

  Write-Step 'Installation de Docker Desktop via winget…'
  & winget install -e --id Docker.DockerDesktop --accept-package-agreements --accept-source-agreements
  if ($LASTEXITCODE -ne 0 -and $LASTEXITCODE -ne -1978335189) {
    # -1978335189 = déjà installé (winget)
    throw "winget install Docker.DockerDesktop a échoué (code $LASTEXITCODE)."
  }

  Write-Host 'En attente de Docker (jusqu''à 3 min)…'
  $deadline = (Get-Date).AddMinutes(3)
  while ((Get-Date) -lt $deadline) {
    if (Test-DockerReady) { return }
    Start-Sleep -Seconds 5
  }

  throw 'Docker Desktop installé mais pas encore prêt. Redémarrez Windows si besoin, puis relancez ce script.'
}

function Ensure-EnvServerFile {
  if (-not (Test-Path -LiteralPath $EnvExample)) {
    throw "Modèle manquant: $EnvExample"
  }

  if (-not (Test-Path -LiteralPath $EnvFile)) {
    Write-Step 'Création de .env.server depuis le modèle…'
    Copy-Item -LiteralPath $EnvExample -Destination $EnvFile
  }

  $content = Get-Content -LiteralPath $EnvFile -Raw
  $updated = $false

  if ($content -match 'POSTGRES_PASSWORD=remplace_par_un_mot_de_passe_fort') {
    $pw = New-RandomSecret -ByteLength 24
    $content = $content -replace 'POSTGRES_PASSWORD=remplace_par_un_mot_de_passe_fort', "POSTGRES_PASSWORD=$pw"
    $updated = $true
    Write-Host 'POSTGRES_PASSWORD généré.'
  }

    if ($content -match 'JWT_SECRET=remplace_par_un_secret_long_et_aleatoire') {
    $jwt = New-RandomSecret -ByteLength 48
    $content = $content -replace 'JWT_SECRET=remplace_par_un_secret_long_et_aleatoire', "JWT_SECRET=$jwt"
    $updated = $true
    Write-Host 'JWT_SECRET généré.'
  }

  if ($content -match 'SYNC_API_KEY=remplace_par_une_cle_sync_longue') {
    $syncKey = New-RandomSecret -ByteLength 32
    $content = $content -replace 'SYNC_API_KEY=remplace_par_une_cle_sync_longue', "SYNC_API_KEY=$syncKey"
    $updated = $true
    Write-Host 'SYNC_API_KEY généré.'
  }

  if ($updated) {
    Set-Content -LiteralPath $EnvFile -Value $content -NoNewline -Encoding UTF8
  }
}

function Configure-GcpDockerAuth {
  if (-not (Get-Command gcloud -ErrorAction SilentlyContinue)) {
    Write-Warning "gcloud CLI absent — configurez l'auth Artifact Registry manuellement :"
    Write-Warning "  gcloud auth configure-docker $GcpRegistry --quiet"
    return
  }

  Write-Step "Authentification Docker → $GcpRegistry …"
  & gcloud auth configure-docker $GcpRegistry --quiet
  if ($LASTEXITCODE -ne 0) {
    throw "gcloud auth configure-docker a échoué. Exécutez « gcloud auth login » puis relancez."
  }
}

function Start-ServerStack {
  Write-Step 'Pull de l''image backend (Artifact Registry)…'
  Push-Location $DockerDir
  try {
    & docker compose -f $ComposeFile --env-file $EnvFile pull
    if ($LASTEXITCODE -ne 0) {
      throw "docker compose pull a échoué (code $LASTEXITCODE). Vérifiez gcloud auth et l'accès réseau."
    }

    Write-Step 'Démarrage Postgres + API + sync-agent…'
    & docker compose -f $ComposeFile --env-file $EnvFile up -d --build
    if ($LASTEXITCODE -ne 0) {
      throw "docker compose up a échoué (code $LASTEXITCODE)."
    }
  } finally {
    Pop-Location
  }
}

function Register-ServerScheduledTask {
  if ($SkipScheduledTask) {
    Write-Host 'Tâche planifiée ignorée (-SkipScheduledTask).'
    return
  }

  $existing = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
  if ($existing) {
    Write-Host "Tâche planifiée déjà présente : $TaskName"
    return
  }

  $action = New-ScheduledTaskAction -Execute 'powershell.exe' `
    -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$StartScript`" -MonorepoRoot `"$RepoRoot`""

  $trigger = New-ScheduledTaskTrigger -AtLogon -User $env:USERNAME
  $trigger.Delay = 'PT1M'

  $settings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -StartWhenAvailable `
    -MultipleInstances IgnoreNew

  try {
    Register-ScheduledTask `
      -TaskName $TaskName `
      -Action $action `
      -Trigger $trigger `
      -Settings $settings `
      -Description 'Démarre Postgres MASTER + API POS (édition Server, localhost:3000)' | Out-Null
    Write-Host "Tâche planifiée créée : $TaskName (au logon, délai 1 min)"
  } catch {
    Write-Warning "Impossible de créer la tâche planifiée (droits admin ?). Démarrez manuellement :"
    Write-Warning "  powershell -ExecutionPolicy Bypass -File `"$StartScript`""
  }
}

Write-Step "Bootstrap Server — $RepoRoot"

Install-DockerDesktopIfNeeded
Ensure-EnvServerFile
Configure-GcpDockerAuth
Start-ServerStack
Register-ServerScheduledTask

Write-Step 'Terminé'
Write-Host 'API locale : http://localhost:3000'
Write-Host 'Postgres   : localhost:5432 (conteneur pos_postgres_server)'
Write-Host 'Installateur desktop : npm run dist:win:server (apps/desktop)'
