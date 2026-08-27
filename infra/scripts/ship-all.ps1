#Requires -Version 5.1
<#
.SYNOPSIS
  Pipeline de livraison POS Eau Cascade : version → commit/push GitHub → backend GCP → installateurs GCS.

.DESCRIPTION
  Une seule commande quand le développement est terminé :

    powershell -ExecutionPolicy Bypass -File infra/scripts/ship-all.ps1 -Bump patch -Commit

  Par défaut :
    1. Répare le PATH Windows (scoop git/gcloud/gh) puis assert projet GCP = eau-cascade
    2. Aligne SYNC_API_KEY (local Server + VM) sans redeployer l'ancienne image
    3. Bump semver apps/desktop/package.json (Remote + Server partagent la version)
    4. Commit + push origin (si -Commit)
    5. Déclenche CI « Backend - build and push to GCP » et ATTEND le succès
       (Artifact Registry backend:latest) AVANT de bundler le Server
    6. Build local NSIS Remote + Server, upload GCS (feeds auto-update)

  Critique : la VM GCP et le Docker du PC de dev ne mettent PAS à jour les
  machines mères magasin. Seul l'exe Server (images .tar embarquées) le fait.

  Le runner GitHub n'a pas Docker : -UseCI publie Remote via Actions, le Server
  reste un build local.

.PARAMETER Bump
  patch | minor | major | none

.PARAMETER Desktop
  both | remote | server | none

.PARAMETER Commit
  Commit les changements (y compris le bump) puis push origin.

.PARAMETER Message
  Message de commit. Défaut : Ship Eau Cascade desktop X.Y.Z

.PARAMETER UseCI
  Remote via GitHub Actions (workflow_dispatch). Server reste local (Docker requis).

.PARAMETER SkipPush
  Commit éventuel sans push.

.PARAMETER SkipBackend
  Ne pas déclencher / attendre le workflow backend.

.PARAMETER SkipWaitBackend
  Ne pas attendre le CI backend avant dist:win:server (déconseillé : image stale).

.PARAMETER SkipProvisionSync
  Ne pas aligner SYNC_API_KEY via gcp-provision-sync.ps1.

.PARAMETER DryRun
  Affiche les actions sans les exécuter.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File infra/scripts/ship-all.ps1 -Bump patch -Commit

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File infra/scripts/ship-all.ps1 -Bump none -Desktop none -Commit -Message "fix sync pull"

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File infra/scripts/ship-all.ps1 -Bump patch -Commit -UseCI
#>
param(
  [ValidateSet('patch', 'minor', 'major', 'none')]
  [string] $Bump = 'patch',

  [ValidateSet('both', 'remote', 'server', 'none')]
  [string] $Desktop = 'both',

  [switch] $Commit,
  [string] $Message = '',
  [switch] $UseCI,
  [switch] $SkipPush,
  [switch] $SkipBackend,
  [switch] $SkipWaitBackend,
  [switch] $SkipProvisionSync,
  [switch] $DryRun
)

$ErrorActionPreference = 'Stop'
if ($null -ne (Get-Variable -Name PSNativeCommandUseErrorActionPreference -ErrorAction SilentlyContinue)) {
  $PSNativeCommandUseErrorActionPreference = $false
}

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot = (Resolve-Path -LiteralPath (Join-Path $ScriptDir '..\..')).Path
$DesktopPkg = Join-Path $RepoRoot 'apps\desktop\package.json'
$AssertScript = Join-Path $ScriptDir 'assert-eau-cascade-gcp.ps1'
$UploadScript = Join-Path $ScriptDir 'upload-desktop-installer.ps1'
$ProvisionScript = Join-Path $ScriptDir 'gcp-provision-sync.ps1'

$ExpectedProject = 'eau-cascade'
$GcloudConfig = 'pos-eau-cascade'
$AssetsBucket = 'eau-cascade-assets'
$PublicApi = 'http://35.203.5.250'
$GitHubRepo = 'https://github.com/Mikelaroselouisiv/Eau-Cascade'

function Repair-ProcessPath {
  if ($env:OS -notmatch 'Windows') { return }
  $machine = [Environment]::GetEnvironmentVariable('Path', 'Machine')
  $user = [Environment]::GetEnvironmentVariable('Path', 'User')
  if ($machine -or $user) {
    $env:Path = "$machine;$user;$env:Path"
  }
}

function Get-ToolPath([string] $Name) {
  $cmd = Get-Command $Name -ErrorAction SilentlyContinue
  if ($cmd) { return $cmd.Source }
  $fallbacks = @{
    git    = @(
      "$env:USERPROFILE\scoop\shims\git.exe",
      "$env:USERPROFILE\scoop\apps\git\current\cmd\git.exe",
      'C:\Program Files\Git\cmd\git.exe'
    )
    gh     = @(
      "$env:USERPROFILE\scoop\shims\gh.exe",
      'C:\Program Files\GitHub CLI\gh.exe'
    )
    gcloud = @(
      "$env:USERPROFILE\scoop\shims\gcloud.cmd",
      "$env:LOCALAPPDATA\Google\Cloud SDK\google-cloud-sdk\bin\gcloud.cmd"
    )
  }
  foreach ($p in @($fallbacks[$Name])) {
    if ($p -and (Test-Path -LiteralPath $p)) { return $p }
  }
  return $null
}

function Write-Step([string] $Text) {
  Write-Host ""
  Write-Host "=== $Text ===" -ForegroundColor Cyan
}

function Invoke-OrDry([string] $Label, [scriptblock] $Action) {
  if ($DryRun) {
    Write-Host "[dry-run] $Label" -ForegroundColor Yellow
    return
  }
  Write-Host ("-> {0}" -f $Label) -ForegroundColor Gray
  & $Action
}

function Get-GhExe {
  $gh = Get-ToolPath 'gh'
  if (-not $gh) { return $null }
  return $gh
}

function Wait-BackendGcpCi {
  $gh = Get-GhExe
  if (-not $gh) {
    Write-Host "gh missing - cannot wait for CI. Confirm AR backend:latest manually." -ForegroundColor Yellow
    return
  }

  $deadline = (Get-Date).AddMinutes(35)
  Write-Host "Waiting for backend CI (Artifact Registry) before Server bundle..." -ForegroundColor Cyan
  $fields = 'databaseId,status,conclusion,createdAt,url'

  while ((Get-Date) -lt $deadline) {
    $json = & $gh run list --workflow 'Backend - build and push to GCP' --limit 5 --json $fields
    if ($LASTEXITCODE -ne 0 -or -not $json) {
      Start-Sleep -Seconds 8
      continue
    }
    $runs = @($json | ConvertFrom-Json)
    if ($runs.Count -eq 0) {
      Start-Sleep -Seconds 8
      continue
    }

    $activeList = @($runs | Where-Object { $_.status -ne 'completed' })
    if ($activeList.Count -gt 0) {
      $activeRun = $activeList[0]
      $runId = '{0}' -f $activeRun.databaseId
      if ($runId -notmatch '^\d+$') {
        throw "Invalid backend CI run id '$runId' (expected single numeric id)."
      }
      $runStatus = '{0}' -f $activeRun.status
      $runUrl = '{0}' -f $activeRun.url
      Write-Host ("-> gh run watch {0} ({1}) {2}" -f $runId, $runStatus, $runUrl) -ForegroundColor Gray
      & $gh run watch $runId --exit-status
      if ($LASTEXITCODE -ne 0) {
        throw "Backend CI failed (run $runId). Abort Server build to avoid stale image."
      }
      Write-Host "Backend CI OK - AR backend:latest ready for prepare-server-stack." -ForegroundColor Green
      return
    }

    $done = $runs[0]
    $doneConclusion = '{0}' -f $done.conclusion
    $doneId = '{0}' -f $done.databaseId
    if ($doneConclusion -eq 'success') {
      Write-Host ("Backend CI already success (run {0})." -f $doneId) -ForegroundColor Green
      return
    }
    if ($doneConclusion -and $doneConclusion -ne 'success') {
      throw ("Latest backend CI = {0} (run {1}). Fix before Server build." -f $doneConclusion, $doneId)
    }
    Start-Sleep -Seconds 8
  }
  throw 'Timeout 35 min waiting for backend GCP CI.'
}

function Get-DesktopVersion {
  $raw = Get-Content -LiteralPath $DesktopPkg -Raw -Encoding UTF8
  if ($raw -match '"version"\s*:\s*"([^"]+)"') { return $Matches[1] }
  throw "Impossible de lire version dans $DesktopPkg"
}

function Set-DesktopVersion([string] $NewVersion) {
  $bytes = [System.IO.File]::ReadAllBytes($DesktopPkg)
  $offset = 0
  if ($bytes.Length -ge 3 -and $bytes[0] -eq 0xEF -and $bytes[1] -eq 0xBB -and $bytes[2] -eq 0xBF) {
    $offset = 3
  }
  $utf8NoBom = New-Object System.Text.UTF8Encoding $false
  $raw = $utf8NoBom.GetString($bytes, $offset, $bytes.Length - $offset)
  $updated = [regex]::Replace($raw, '("version"\s*:\s*")[^"]+(")', "`${1}$NewVersion`${2}", 1)
  if ($updated -eq $raw) { throw "Bump version échoué ($NewVersion)" }
  [System.IO.File]::WriteAllText($DesktopPkg, $updated, $utf8NoBom)
}

function Ensure-GitIdentity {
  $existing = & $git config --get user.email 2>$null
  if ($existing) { return }
  $name = (& $git log -1 --format='%an' 2>$null)
  $email = (& $git log -1 --format='%ae' 2>$null)
  if (-not $name) { $name = 'Mike DG' }
  if (-not $email) { $email = 'mikedg@MacBook-Pro.local' }
  $env:GIT_AUTHOR_NAME = $name
  $env:GIT_AUTHOR_EMAIL = $email
  $env:GIT_COMMITTER_NAME = $name
  $env:GIT_COMMITTER_EMAIL = $email
  Write-Host "Git identity (env, no config write): $name <$email>" -ForegroundColor Gray
}

function Bump-SemVer([string] $Current, [string] $Kind) {
  $parts = $Current.Split('.')
  if ($parts.Count -lt 3) { throw "Version invalide: $Current (attendu X.Y.Z)" }
  $major = [int]$parts[0]; $minor = [int]$parts[1]; $patch = [int]$parts[2]
  switch ($Kind) {
    'major' { return "$( $major + 1 ).0.0" }
    'minor' { return "$major.$( $minor + 1 ).0" }
    'patch' { return "$major.$minor.$( $patch + 1 )" }
    default { return $Current }
  }
}

Repair-ProcessPath
Set-Location -LiteralPath $RepoRoot

$git = Get-ToolPath 'git'
$gcloud = Get-ToolPath 'gcloud'
if (-not $git) { throw 'git introuvable (installez Git / scoop git).' }

Write-Step "Eau Cascade ship-all"
Write-Host "Repo: $RepoRoot"
Write-Host "Bump=$Bump Desktop=$Desktop Commit=$Commit UseCI=$UseCI DryRun=$DryRun"

# --- 1. GCP assert ---
if (-not $DryRun -and ($Desktop -ne 'none' -or -not $SkipBackend)) {
  Write-Step "Assert GCP Eau Cascade"
  if (-not $gcloud) { throw 'gcloud introuvable. Activez pos-eau-cascade puis relancez.' }
  try {
    & $gcloud config configurations activate $GcloudConfig 2>$null | Out-Null
  } catch { }
  & $gcloud config set project $ExpectedProject --quiet
  & $AssertScript
}

# --- 1b. Align SYNC_API_KEY (no old-image redeploy) ---
if (-not $SkipProvisionSync -and -not $SkipBackend) {
  Write-Step "Align SYNC_API_KEY (SkipDeploy)"
  Invoke-OrDry "gcp-provision-sync.ps1 -SkipDeploy" {
    & $ProvisionScript -SkipDeploy
  }
}

# --- 2. Version bump ---
$version = Get-DesktopVersion
if ($Bump -ne 'none' -and $Desktop -ne 'none') {
  Write-Step "Bump desktop $version → …"
  $version = Bump-SemVer $version $Bump
  Invoke-OrDry "Écrire version $version dans apps/desktop/package.json" {
    Set-DesktopVersion $version
  }
  Write-Host "Version desktop: $version"
} else {
  Write-Host "Version desktop (inchangée): $version"
}

# --- 3. Git commit + push ---
if ($Commit) {
  Write-Step "Git commit + push"
  Ensure-GitIdentity
  if (-not $Message) {
    if ($Desktop -ne 'none' -and $Bump -ne 'none') {
      $Message = "Ship Eau Cascade desktop $version"
    } else {
      $Message = "Ship Eau Cascade"
    }
  }

  Invoke-OrDry "git add -A (hors secrets)" {
    & $git add -A
    & $git reset HEAD -- secrets/ 2>$null
    & $git diff --cached --name-only | ForEach-Object {
      if (
        $_ -match '\.pem$' -or
        $_ -match '(^|/)\.env$' -or
        $_ -match '(^|/)\.env\.(dev|prod|local|server)$' -or
        $_ -match 'ChatGPT Image' -or
        $_ -match '(^|/)apps/backend/dist/' -or
        $_ -match '(^|/)apps/desktop/release/'
      ) {
        & $git reset HEAD -- $_ 2>$null
        Write-Host "  (exclu) $_" -ForegroundColor Yellow
      }
    }
  }

  $staged = @()
  if (-not $DryRun) {
    $staged = @(& $git diff --cached --name-only)
  }
  if ($DryRun -or $staged.Count -gt 0) {
    Invoke-OrDry "git commit -m `"$Message`"" {
      & $git commit -m $Message
      if ($LASTEXITCODE -ne 0) { throw "git commit a échoué (rien à committer ?)" }
    }
  } else {
    Write-Host "Rien à committer (working tree déjà propre hors bump éventuel)." -ForegroundColor Yellow
  }

  if (-not $SkipPush) {
    Invoke-OrDry "git push origin HEAD" {
      & $git push -u origin HEAD
      if ($LASTEXITCODE -ne 0) { throw "git push a échoué" }
    }
  }
} else {
  Write-Host "Skip git commit (passe -Commit pour commit+push)." -ForegroundColor Yellow
}

# --- 4. Backend CI ---
$gh = Get-GhExe
if (-not $SkipBackend) {
  Write-Step "Backend → GCP (Artifact Registry + VM)"
  if ($UseCI -or $Commit) {
    if ($gh -and -not $SkipPush) {
      $ref = (& $git branch --show-current)
      Invoke-OrDry "gh workflow run `"Backend - build and push to GCP`"" {
        & $gh workflow run "Backend - build and push to GCP" --ref $ref
        if ($LASTEXITCODE -ne 0) {
          Write-Host "Avertissement: déclenchement manuel backend échoué (CI push peut suffire)." -ForegroundColor Yellow
        } else {
          Write-Host "Workflow backend déclenché."
        }
      }
    } else {
      Write-Host "Backend: déployé automatiquement par push main si fichiers backend/infra touchés."
      Write-Host "         Ou : Actions → Backend - build and push to GCP → Run workflow"
    }
  } else {
    Write-Host "Backend: -Commit ou -UseCI recommandé pour déclencher le déploiement."
  }
}

# --- 5. Desktop Remote / Server ---
$needsServerBundle = ($Desktop -eq 'both' -or $Desktop -eq 'server')
$needsRemote = ($Desktop -eq 'both' -or $Desktop -eq 'remote')
if ($needsServerBundle -and -not $SkipBackend -and -not $SkipWaitBackend) {
  Write-Step "Wait backend AR before magasin Server bundle"
  Invoke-OrDry "Wait-BackendGcpCi (pull latest into server-stack images)" {
    Wait-BackendGcpCi
  }
} elseif ($needsServerBundle -and $SkipWaitBackend) {
  Write-Host "WARNING: -SkipWaitBackend - Server may embed a stale backend:latest." -ForegroundColor Yellow
}

Write-Host ("Desktop build gate: Desktop={0} UseCI={1}" -f $Desktop, [bool]$UseCI) -ForegroundColor Cyan

if ($Desktop -eq 'none') {
  Write-Host "Desktop: skip (-Desktop none) - magasin Servers will NOT be updated."
} else {
  if ($UseCI -and $needsRemote) {
    Write-Step "Desktop Remote via GitHub Actions"
    if ($gh -and -not $SkipPush) {
      $ref = (& $git branch --show-current)
      Invoke-OrDry "gh workflow run Desktop - release to GCS -f edition=remote" {
        & $gh workflow run "Desktop - release to GCS" --ref $ref -f edition=remote
        if ($LASTEXITCODE -ne 0) { throw 'Déclenchement workflow Remote échoué' }
        Write-Host "Workflow Remote déclenché (GCS installers/remote)."
      }
    } else {
      Write-Host "gh manquant ou -SkipPush : impossible de déclencher le CI Remote." -ForegroundColor Yellow
    }
  }

  $localEditions = @()
  if ($needsRemote -and -not $UseCI) { $localEditions += 'remote' }
  if ($needsServerBundle) { $localEditions += 'server' }

  if ($localEditions.Count -gt 0) {
    Write-Step "Desktop build local + upload GCS"
    Push-Location (Join-Path $RepoRoot 'apps\desktop')
    try {
      foreach ($ed in $localEditions) {
        Invoke-OrDry "npm run dist:win:$ed" {
          npm run "dist:win:$ed"
          if ($LASTEXITCODE -ne 0) { throw "Build dist:win:$ed échoué" }
        }
      }
    } finally {
      Pop-Location
    }

    foreach ($ed in $localEditions) {
      Invoke-OrDry "upload-desktop-installer.ps1 -Edition $ed" {
        & $UploadScript -Edition $ed
      }
    }
  }
}

# --- 6. Rapport ---
Write-Step "Livraison terminée"
Write-Host "Desktop version : $version"
Write-Host "Feeds MAJ :"
Write-Host "  Remote: https://storage.googleapis.com/$AssetsBucket/installers/remote/latest.yml"
Write-Host "  Server: https://storage.googleapis.com/$AssetsBucket/installers/server/latest.yml"
Write-Host "API cloud  : $PublicApi"
Write-Host "GitHub     : $GitHubRepo"
Write-Host ""
Write-Host "Sur les machines installées : bouton Mise à jour → télécharger → redémarrer."
Write-Host "Les postes Remote vérifient aussi au démarrage et toutes les 4 h."
if ($DryRun) {
  Write-Host "(DryRun : aucune action réelle.)" -ForegroundColor Yellow
}
