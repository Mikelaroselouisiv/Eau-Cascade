#Requires -Version 5.1
<#
.SYNOPSIS
  Provisionne l'infra GCP pour POS Eau Cascade uniquement.
  N'utilise JAMAIS le projet Frères Baziles.
#>
param(
  [string] $ProjectId = 'eau-cascade',
  [string] $Region = 'northamerica-northeast1',
  [string] $Zone = 'northamerica-northeast1-a',
  [string] $ArtifactRepo = 'pos-backend',
  [string] $Bucket = 'eau-cascade-assets',
  [string] $VmName = 'pos-api',
  [string] $MachineType = 'e2-medium',
  [string] $CiSaName = 'github-actions',
  [string] $VmSaName = 'pos-vm',
  [switch] $SkipVm
)

# gcloud.ps1 ecrit sur stderr ("Your active configuration...") — ne pas traiter comme erreur fatale
$ErrorActionPreference = 'Continue'
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
& (Join-Path $ScriptDir 'assert-eau-cascade-gcp.ps1')
if (-not $?) { throw 'assert-eau-cascade-gcp.ps1 a echoue' }

$active = (& gcloud config get-value project 2>$null | Out-String).Trim()
if ($active -ne $ProjectId) {
  throw "ABORT: projet actif=$active (attendu $ProjectId)"
}

function Assert-NotOtherTenant([string] $Value) {
  $l = $Value.ToLowerInvariant()
  if ($l -match 'freres|bazile|israel|pos-entrprise') {
    throw "ABORT: valeur interdite (autre tenant): $Value"
  }
}

Assert-NotOtherTenant $ProjectId
Assert-NotOtherTenant $Bucket

Write-Host "==> Enable APIs ($ProjectId)" -ForegroundColor Cyan
$apis = @(
  'compute.googleapis.com',
  'artifactregistry.googleapis.com',
  'storage.googleapis.com',
  'iam.googleapis.com',
  'iamcredentials.googleapis.com',
  'cloudresourcemanager.googleapis.com',
  'serviceusage.googleapis.com',
  'logging.googleapis.com',
  'monitoring.googleapis.com',
  'secretmanager.googleapis.com',
  'iap.googleapis.com'
)
gcloud services enable $apis --project=$ProjectId

Write-Host "==> Artifact Registry ($ArtifactRepo)" -ForegroundColor Cyan
$repoExists = gcloud artifacts repositories describe $ArtifactRepo --location=$Region --project=$ProjectId 2>$null
if (-not $repoExists) {
  gcloud artifacts repositories create $ArtifactRepo `
    --repository-format=docker `
    --location=$Region `
    --description='POS Eau Cascade backend images' `
    --project=$ProjectId
} else {
  Write-Host 'Artifact Registry already exists'
}

Write-Host "==> GCS bucket ($Bucket)" -ForegroundColor Cyan
$bucketUri = "gs://$Bucket"
if (-not (gsutil ls -b $bucketUri 2>$null)) {
  gsutil mb -p $ProjectId -l $Region $bucketUri
  gsutil uniformbucketlevelaccess set on $bucketUri
} else {
  Write-Host 'Bucket already exists'
}
# Public read for desktop auto-update installers (same pattern as product needs)
gsutil iam ch allUsers:objectViewer $bucketUri 2>$null
@('installers/remote/', 'installers/server/', 'sync-assets/') | ForEach-Object {
  $marker = Join-Path $env:TEMP "pos-eau-cascade-keep-$([guid]::NewGuid().ToString('n')).txt"
  Set-Content -LiteralPath $marker -Value 'keep' -Encoding ascii
  gsutil cp $marker "$bucketUri/$_.keep" 2>$null
  Remove-Item $marker -Force -ErrorAction SilentlyContinue
}

Write-Host "==> Service accounts" -ForegroundColor Cyan
function Ensure-Sa([string] $Name, [string] $Display) {
  $email = "$Name@$ProjectId.iam.gserviceaccount.com"
  $exists = gcloud iam service-accounts describe $email --project=$ProjectId 2>$null
  if (-not $exists) {
    gcloud iam service-accounts create $Name --display-name=$Display --project=$ProjectId
  }
  return $email
}

$ciSa = Ensure-Sa $CiSaName 'GitHub Actions POS Eau Cascade'
$vmSa = Ensure-Sa $VmSaName 'Compute VM POS Eau Cascade'

$ciRoles = @(
  'roles/artifactregistry.writer',
  'roles/storage.admin',
  'roles/compute.instanceAdmin.v1',
  'roles/iam.serviceAccountUser',
  'roles/logging.logWriter'
)
foreach ($role in $ciRoles) {
  gcloud projects add-iam-policy-binding $ProjectId `
    --member="serviceAccount:$ciSa" `
    --role=$role `
    --condition=None `
    --quiet | Out-Null
}

$vmRoles = @(
  'roles/artifactregistry.reader',
  'roles/logging.logWriter',
  'roles/monitoring.metricWriter'
)
foreach ($role in $vmRoles) {
  gcloud projects add-iam-policy-binding $ProjectId `
    --member="serviceAccount:$vmSa" `
    --role=$role `
    --condition=None `
    --quiet | Out-Null
}

Write-Host "==> CI key JSON (local, gitignored)" -ForegroundColor Cyan
$keyDir = Join-Path $ScriptDir '..\..\secrets'
New-Item -ItemType Directory -Force -Path $keyDir | Out-Null
$keyPath = Join-Path $keyDir 'gcp-sa-github-actions.json'
if (-not (Test-Path $keyPath)) {
  gcloud iam service-accounts keys create $keyPath `
    --iam-account=$ciSa `
    --project=$ProjectId
  Write-Host "Wrote $keyPath - add as GitHub secret GCP_SA_KEY"
} else {
  Write-Host "Key already present: $keyPath"
}

if (-not $SkipVm) {
  Write-Host "==> VM $VmName ($Zone)" -ForegroundColor Cyan
  $vmExists = gcloud compute instances describe $VmName --zone=$Zone --project=$ProjectId 2>$null
  $startup = Join-Path $ScriptDir 'gcp-vm-startup.sh'
  if (-not $vmExists) {
    gcloud compute instances create $VmName `
      --project=$ProjectId `
      --zone=$Zone `
      --machine-type=$MachineType `
      --subnet=default `
      --tags="http-server,https-server" `
      --image-family=ubuntu-2204-lts `
      --image-project=ubuntu-os-cloud `
      --boot-disk-size=50GB `
      --boot-disk-type=pd-balanced `
      --service-account=$vmSa `
      --scopes=cloud-platform `
      --metadata-from-file=startup-script=$startup
  } else {
    Write-Host 'VM already exists'
  }

  $fw = gcloud compute firewall-rules describe allow-pos-http --project=$ProjectId 2>$null
  if (-not $fw) {
    gcloud compute firewall-rules create allow-pos-http `
      --project=$ProjectId `
      --allow=tcp:80 `
      --target-tags=http-server `
      --description='POS Eau Cascade public HTTP'
  }
}

$ip = ''
try {
  $ip = gcloud compute instances describe $VmName --zone=$Zone --project=$ProjectId `
    --format='get(networkInterfaces[0].accessConfigs[0].natIP)'
} catch {}

Write-Host ''
Write-Host '======== BOOTSTRAP EAU CASCADE OK ========' -ForegroundColor Green
Write-Host "PROJECT_ID=$ProjectId"
Write-Host "REGION=$Region"
Write-Host "ZONE=$Zone"
Write-Host "ARTIFACT=northamerica-northeast1-docker.pkg.dev/$ProjectId/$ArtifactRepo/backend"
Write-Host "BUCKET=gs://$Bucket"
Write-Host "VM=$VmName"
Write-Host "VM_IP=$ip"
Write-Host "CI_SA=$ciSa"
Write-Host "CI_KEY=$keyPath"
Write-Host ''
Write-Host 'GitHub secrets/vars a poser:'
Write-Host "  secrets.GCP_PROJECT_ID = $ProjectId"
Write-Host '  secrets.GCP_SA_KEY     = contenu JSON du fichier CI_KEY'
Write-Host "  vars.GCP_REGION        = $Region"
Write-Host "  vars.GCP_ARTIFACT_REPO = $ArtifactRepo"
Write-Host "  vars.GCP_VM_NAME       = $VmName"
Write-Host "  vars.GCP_VM_ZONE       = $Zone"
if ($ip) {
  Write-Host "Mettre a jour PUBLIC_API / REMOTE_API_URL vers http://$ip"
}
