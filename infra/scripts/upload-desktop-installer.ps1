#Requires -Version 5.1
<#
.SYNOPSIS
  Publie les artefacts desktop (exe, latest.yml, blockmap) vers GCS.

.PARAMETER Edition
  server -> gs://eau-cascade-assets/installers/server/
  remote -> gs://eau-cascade-assets/installers/remote/

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File infra/scripts/upload-desktop-installer.ps1 -Edition remote
#>
param(
  [Parameter(Mandatory = $true)]
  [ValidateSet('server', 'remote')]
  [string] $Edition,

  [string] $ReleaseDir = '',
  [string] $Bucket = 'eau-cascade-assets'
)

$ErrorActionPreference = 'Stop'

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot = (Resolve-Path -LiteralPath (Join-Path $ScriptDir '..\..')).Path
$ResolvedReleaseDir = if ($ReleaseDir) {
  (Resolve-Path -LiteralPath $ReleaseDir).Path
} else {
  Join-Path $RepoRoot 'apps\desktop\release'
}

if (-not (Test-Path -LiteralPath $ResolvedReleaseDir)) {
  Write-Error "Dossier release introuvable: $ResolvedReleaseDir - lancez dist:win:$Edition d'abord."
}

if (-not (Get-Command gsutil -ErrorAction SilentlyContinue)) {
  Write-Error 'gsutil requis (Google Cloud SDK). Installez gcloud puis relancez.'
}

$editionToken = if ($Edition -eq 'remote') { 'Remote' } else { 'Server' }
$dest = "gs://$Bucket/installers/$Edition/"

$latest = Join-Path $ResolvedReleaseDir 'latest.yml'
if (-not (Test-Path -LiteralPath $latest)) {
  Write-Error "latest.yml introuvable dans $ResolvedReleaseDir - lancez dist:win:$Edition d'abord."
}
$latestText = Get-Content -LiteralPath $latest -Raw
if ($latestText -notmatch [regex]::Escape("POS-Eau-Cascade-$editionToken-")) {
  Write-Error "latest.yml ne correspond pas a l'edition $Edition. Relancez dist:win:$Edition avant upload."
}
if ($latestText -notmatch "path:\s*(POS-Eau-Cascade-$editionToken-[\d.]+\.exe)") {
  Write-Error "Impossible de lire le path exe dans latest.yml"
}
$exeName = $Matches[1]
$exePath = Join-Path $ResolvedReleaseDir $exeName
$blockmapPath = "$exePath.blockmap"
if (-not (Test-Path -LiteralPath $exePath)) {
  Write-Error "Exe manquant: $exePath"
}

# Only the version referenced by latest.yml (release/ may contain older builds + both editions).
$files = @(
  (Get-Item -LiteralPath $exePath),
  (Get-Item -LiteralPath $latest)
)
if (Test-Path -LiteralPath $blockmapPath) {
  $files += Get-Item -LiteralPath $blockmapPath
}

Write-Host "Upload $Edition ($editionToken) -> $dest"
foreach ($file in $files) {
  Write-Host "  -> $($file.Name)"
  $gsArgs = @('cp')
  if ($file.Name -eq 'latest.yml') {
    $gsArgs = @('-h', 'Cache-Control:no-cache,max-age=0', 'cp')
    Write-Host '    Cache-Control: no-cache'
  }
  & gsutil @gsArgs $file.FullName $dest
  if ($LASTEXITCODE -ne 0) {
    throw "gsutil cp a echoue pour $($file.Name)"
  }
}

Write-Host "Termine. URL publique: https://storage.googleapis.com/$Bucket/installers/$Edition/"
