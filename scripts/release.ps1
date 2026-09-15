<#
.SYNOPSIS
  Cut a TRXController release: bump the version on main, tag it and push.

.DESCRIPTION
  Runs, in order, stopping at the first failure:
    git checkout main
    git pull
    npm version <patch|minor|major>
    git push --follow-tags
  The pushed v* tag starts .github/workflows/release.yml, which builds the
  Windows installer and attaches it to a GitHub Release.

.PARAMETER Bump
  patch (0.2.1 -> 0.2.2, default), minor (0.2.1 -> 0.3.0) or major (0.2.1 -> 1.0.0).

.EXAMPLE
  .\scripts\release.ps1
  .\scripts\release.ps1 minor
#>
[CmdletBinding()]
param(
  [ValidateSet('patch', 'minor', 'major')]
  [string]$Bump = 'patch'
)

$ErrorActionPreference = 'Stop'

function Invoke-Step {
  param([string]$Label, [scriptblock]$Command)
  Write-Host "==> $Label" -ForegroundColor Cyan
  & $Command
  if ($LASTEXITCODE -ne 0) {
    Write-Host "Failed: $Label (exit $LASTEXITCODE). Nothing further was run." -ForegroundColor Red
    exit $LASTEXITCODE
  }
}

# Always work from the repository root, wherever the script was started.
$root = Resolve-Path (Join-Path $PSScriptRoot '..')
Set-Location $root

# npm version refuses a dirty tree; say so up front with the offending files.
$dirty = git status --porcelain
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
if ($dirty) {
  Write-Host 'Working tree has uncommitted changes. Commit or stash them first:' -ForegroundColor Red
  $dirty | ForEach-Object { Write-Host "  $_" }
  exit 1
}

Invoke-Step 'git checkout main'      { git checkout main }
Invoke-Step 'git pull'               { git pull }
Invoke-Step "npm version $Bump"      { npm version $Bump }
Invoke-Step 'git push --follow-tags' { git push --follow-tags }

$version = node -p "require('./package.json').version"
$remote = (git remote get-url origin) -replace '\.git$', ''
Write-Host ''
Write-Host "Tagged v$version. The Release workflow is building the installer:" -ForegroundColor Green
Write-Host "  $remote/actions"
Write-Host "It will appear in a few minutes at:"
Write-Host "  $remote/releases/tag/v$version"
