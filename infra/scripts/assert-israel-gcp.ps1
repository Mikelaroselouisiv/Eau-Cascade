#Requires -Version 5.1
<#
.SYNOPSIS
  Refuse toute ops GCP si le projet actif n'est pas Entreprises Israel.
#>
$ErrorActionPreference = 'Continue'

$ExpectedProject = 'pos-entrprise-israel'
$ForbiddenSubstrings = @('freres', 'bazile', 'baziles', 'pos-freres')

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
  throw 'Aucun projet gcloud actif. Activez pos-israel puis : gcloud config set project pos-entrprise-israel'
}

$lower = $project.ToLowerInvariant()
foreach ($bad in $ForbiddenSubstrings) {
  if ($lower -like "*$bad*") {
    throw "ABORT: projet interdit '$project' (ressemble a Freres Baziles). Restez sur $ExpectedProject."
  }
}

if ($project -ne $ExpectedProject) {
  throw "ABORT: projet actif='$project' attendu='$ExpectedProject'. gcloud config configurations activate pos-israel"
}

Write-Host "OK GCP Israel: project=$project account=$account" -ForegroundColor Green
