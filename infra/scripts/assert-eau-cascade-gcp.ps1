#Requires -Version 5.1
<#
.SYNOPSIS
  Refuse toute ops GCP si le projet actif n'est pas Eau Cascade.
#>
$ErrorActionPreference = 'Continue'

$ExpectedProject = 'eau-cascade'
$ForbiddenSubstrings = @('freres', 'bazile', 'baziles', 'pos-freres', 'israel', 'pos-entrprise')

function Get-GcloudValue([string] $Key) {
  $prev = $ErrorActionPreference
  $ErrorActionPreference = 'SilentlyContinue'
  $raw = & gcloud config get-value $Key 2>$null
  $ErrorActionPreference = $prev
  if (-not $raw) { return '' }
  return ([string]$raw).Trim()
}

$project = Get-GcloudValue 'project'
$account = Get-GcloudValue 'account'

if (-not $project) {
  throw 'Aucun projet gcloud actif. Activez pos-eau-cascade puis : gcloud config set project eau-cascade'
}

$lower = $project.ToLowerInvariant()
foreach ($bad in $ForbiddenSubstrings) {
  if ($lower -like "*$bad*") {
    throw "ABORT: projet interdit '$project' (autre tenant). Restez sur $ExpectedProject."
  }
}

if ($project -ne $ExpectedProject) {
  throw "ABORT: projet actif='$project' attendu='$ExpectedProject'. gcloud config configurations activate pos-eau-cascade"
}

Write-Host "OK GCP Eau Cascade: project=$project account=$account" -ForegroundColor Green
