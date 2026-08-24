#Requires -Version 7.0
<#
.SYNOPSIS
  Publie une APK Android et son manifeste de mise à jour dans le bucket Eau Cascade.

.EXAMPLE
  pwsh ./infra/scripts/upload-mobile-apk.ps1 `
    -ApkPath ./apps/mobile/android/app/build/outputs/apk/release/app-release.apk `
    -Notes "Correction connexion Android"
#>
param(
  [string] $ApkPath = '',
  [string] $Version = '',
  [int] $VersionCode = 0,
  [string] $Notes = '',
  [switch] $Mandatory,
  [string] $Bucket = 'eau-cascade-assets'
)

$ErrorActionPreference = 'Stop'
$ExpectedProject = 'eau-cascade'
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot = (Resolve-Path -LiteralPath (Join-Path $ScriptDir '..\..')).Path
$GuardScript = Join-Path $ScriptDir 'assert-eau-cascade-gcp.ps1'
$AppJsonPath = Join-Path $RepoRoot 'apps\mobile\app.json'
$DefaultApkPath = Join-Path $RepoRoot 'apps\mobile\android\app\build\outputs\apk\release\app-release.apk'

if ($Bucket -match 'freres|bazile|baziles') {
  throw "ABORT: bucket interdit '$Bucket'."
}
if ($Bucket -ne 'eau-cascade-assets') {
  throw "ABORT: bucket '$Bucket' non autorise. Attendu: eau-cascade-assets."
}
if (-not (Get-Command gsutil -ErrorAction SilentlyContinue)) {
  throw 'gsutil requis (Google Cloud SDK).'
}
if (-not (Test-Path -LiteralPath $AppJsonPath)) {
  throw "app.json introuvable: $AppJsonPath"
}

$AppConfig = Get-Content -LiteralPath $AppJsonPath -Raw | ConvertFrom-Json
if (-not $Version) {
  $Version = [string] $AppConfig.expo.version
}
if ($VersionCode -le 0) {
  $VersionCode = [int] $AppConfig.expo.android.versionCode
}
if ($Version -notmatch '^\d+\.\d+\.\d+([+-][0-9A-Za-z.-]+)?$') {
  throw "Version invalide: '$Version'. Format attendu: 1.2.3"
}
if ($VersionCode -le 0) {
  throw "VersionCode invalide: '$VersionCode'."
}

$ResolvedApk = if ($ApkPath) {
  (Resolve-Path -LiteralPath $ApkPath).Path
} else {
  (Resolve-Path -LiteralPath $DefaultApkPath).Path
}
if (-not (Test-Path -LiteralPath $ResolvedApk -PathType Leaf)) {
  throw "APK introuvable: $ResolvedApk"
}

function Assert-EauCascadeContext {
  & $GuardScript
  if ($LASTEXITCODE -ne 0) {
    throw "Contexte GCP invalide. Projet attendu: $ExpectedProject"
  }
}

$ObjectName = "POS-Eau-Cascade-$Version-$VersionCode.apk"
$BaseUri = "gs://$Bucket/installers/mobile/android"
$ApkUri = "$BaseUri/$ObjectName"
$LatestApkUri = "$BaseUri/latest.apk"
$ManifestUri = "$BaseUri/latest.json"
$PublicBaseUrl = "https://storage.googleapis.com/$Bucket/installers/mobile/android"
$Hash = (Get-FileHash -LiteralPath $ResolvedApk -Algorithm SHA256).Hash.ToLowerInvariant()
$Size = (Get-Item -LiteralPath $ResolvedApk).Length
$ManifestPath = Join-Path ([System.IO.Path]::GetTempPath()) "pos-eau-cascade-mobile-$([guid]::NewGuid().ToString('n')).json"

$Manifest = [ordered]@{
  version = $Version
  versionCode = $VersionCode
  apkUrl = "$PublicBaseUrl/$ObjectName"
  sha256 = $Hash
  size = $Size
  publishedAt = [DateTimeOffset]::UtcNow.ToString('o')
  notes = $Notes
  mandatory = [bool] $Mandatory
}

try {
  $Manifest | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $ManifestPath -Encoding utf8NoBOM

  Write-Host "Publication Android Eau Cascade: version=$Version code=$VersionCode"

  Assert-EauCascadeContext
  & gsutil -h 'Cache-Control:public,max-age=31536000,immutable' cp $ResolvedApk $ApkUri
  if ($LASTEXITCODE -ne 0) { throw "Echec upload APK: $ApkUri" }

  Assert-EauCascadeContext
  & gsutil cp $ApkUri $LatestApkUri
  if ($LASTEXITCODE -ne 0) { throw "Echec creation latest.apk" }

  Assert-EauCascadeContext
  & gsutil -h 'Cache-Control:no-store,max-age=0' cp $ManifestPath $ManifestUri
  if ($LASTEXITCODE -ne 0) { throw "Echec upload latest.json" }

  Assert-EauCascadeContext
  & gsutil setmeta -h 'Cache-Control:no-cache,max-age=0,must-revalidate' $LatestApkUri
  if ($LASTEXITCODE -ne 0) {
    Write-Host "Avertissement: metadata latest.apk non appliquees (le manifeste est deja en ligne)."
  }

  Write-Host "APK: $PublicBaseUrl/$ObjectName"
  Write-Host "Manifeste: $PublicBaseUrl/latest.json"
  Write-Host "SHA-256: $Hash"
} finally {
  Remove-Item -LiteralPath $ManifestPath -Force -ErrorAction SilentlyContinue
}
