#Requires -Version 5.1
<#
.SYNOPSIS
  Publie les artefacts desktop (exe, latest.yml, blockmap) vers GCS.

.PARAMETER Edition
  server → gs://eau-cascade-assets/installers/server/
  remote → gs://eau-cascade-assets/installers/remote/

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
  Write-Error "Dossier release introuvable: $ResolvedReleaseDir — lancez dist:win:$Edition d'abord."
}

if (-not (Get-Command gsutil -ErrorAction SilentlyContinue)) {
  Write-Error 'gsutil requis (Google Cloud SDK). Installez gcloud puis relancez.'
}

$dest = "gs://$Bucket/installers/$Edition/"
$patterns = @('*.exe', 'latest.yml', '*.blockmap')

Write-Host "Upload $ResolvedReleaseDir → $dest"

foreach ($pattern in $patterns) {
  $files = Get-ChildItem -LiteralPath $ResolvedReleaseDir -Filter $pattern -File -ErrorAction SilentlyContinue
  foreach ($file in $files) {
    Write-Host "  -> $($file.Name)"
    & gsutil cp $file.FullName $dest
    if ($LASTEXITCODE -ne 0) {
      throw "gsutil cp a echoue pour $($file.Name)"
    }
  }
}

# latest.yml doit être revalidé immédiatement (sinon cache GCS ~1 h → détection retardée).
$latestRemote = "${dest}latest.yml"
Write-Host "Cache-Control: no-cache sur latest.yml"
& gsutil setmeta -h "Cache-Control:no-cache,max-age=0" $latestRemote
if ($LASTEXITCODE -ne 0) {
  Write-Warning "Impossible de fixer Cache-Control sur latest.yml (objet absent ?)."
}

Write-Host "Termine. URL publique (Remote updater) : https://storage.googleapis.com/$Bucket/installers/$Edition/"
