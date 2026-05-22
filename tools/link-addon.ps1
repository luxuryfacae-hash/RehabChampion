<#
.SYNOPSIS
    Junctions the repo's addon trees into the Dota 2 Workshop addon folders so the
    Workshop Tools (Hammer, asset compiler, the game itself) read live from this repo.

.DESCRIPTION
    Creates two directory junctions:
        <Dota>/game/dota_addons/r3hab_pit_of_champions    -> repo/addon/game/dota_addons/r3hab_pit_of_champions
        <Dota>/content/dota_addons/r3hab_pit_of_champions -> repo/addon/content/dota_addons/r3hab_pit_of_champions

    Junctions are used (not symlinks) because they do not require admin/Developer Mode
    and work across the same volume. If a target already exists it is reported and left
    alone unless -Force is passed.

    IMPORTANT: If the target paths currently hold the ORIGINAL addon files (not yet moved
    into the repo), this script will refuse to clobber a real directory unless -Force is
    given. Make sure the repo copy under addon/ is authoritative before linking.

.PARAMETER DotaPath
    Path to the "dota 2 beta" install folder.

.PARAMETER Force
    Remove an existing real directory or stale junction at the target before linking.
    Use with care: -Force deletes whatever is at the Dota-side target path.

.EXAMPLE
    ./tools/link-addon.ps1
    ./tools/link-addon.ps1 -Force
#>
[CmdletBinding()]
param(
    [string]$DotaPath = "C:\Program Files (x86)\Steam\steamapps\common\dota 2 beta",
    [switch]$Force
)

$ErrorActionPreference = "Stop"
$addonId = "r3hab_pit_of_champions"

# Repo root = parent of the folder this script lives in (tools/).
$repoRoot = Split-Path -Parent $PSScriptRoot

$links = @(
    @{ Name = "game";    Target = Join-Path $DotaPath "game\dota_addons\$addonId";    Source = Join-Path $repoRoot "addon\game\dota_addons\$addonId" },
    @{ Name = "content"; Target = Join-Path $DotaPath "content\dota_addons\$addonId"; Source = Join-Path $repoRoot "addon\content\dota_addons\$addonId" }
)

# Validate sources exist before we touch anything on the Dota side.
foreach ($l in $links) {
    if (-not (Test-Path -LiteralPath $l.Source)) {
        throw "Repo source missing: $($l.Source). Run the import first."
    }
}

Write-Host "About to junction the Dota addon folders to this repo:" -ForegroundColor Cyan
foreach ($l in $links) {
    Write-Host "  [$($l.Name)] $($l.Target)  ->  $($l.Source)"
}
$answer = Read-Host "Proceed? (y/N)"
if ($answer -ne "y") {
    Write-Host "Aborted." -ForegroundColor Yellow
    exit 1
}

foreach ($l in $links) {
    $target = $l.Target
    $parent = Split-Path -Parent $target
    if (-not (Test-Path -LiteralPath $parent)) {
        New-Item -ItemType Directory -Path $parent -Force | Out-Null
    }

    if (Test-Path -LiteralPath $target) {
        $item = Get-Item -LiteralPath $target -Force
        $isReparse = ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0
        if ($isReparse) {
            Write-Host "  Removing existing junction at $target" -ForegroundColor Yellow
            # Remove the reparse point only; does not recurse into the link target.
            cmd /c rmdir "$target" | Out-Null
        }
        elseif ($Force) {
            Write-Host "  -Force: removing existing directory $target" -ForegroundColor Red
            Remove-Item -LiteralPath $target -Recurse -Force
        }
        else {
            Write-Warning "Target exists and is a real directory: $target`n  Re-run with -Force to replace it (it will be DELETED). Skipping."
            continue
        }
    }

    New-Item -ItemType Junction -Path $target -Target $l.Source | Out-Null
    Write-Host "  Linked [$($l.Name)] OK" -ForegroundColor Green
}

Write-Host "Done. Launch Dota 2 via the Workshop Tools to verify the addon appears." -ForegroundColor Cyan
