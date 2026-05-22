<#
.SYNOPSIS
    Wraps Dota 2's resourcecompiler.exe to compile addon content (maps, particles, materials)
    from source (content/) into runtime artifacts (game/, *_c files).

.DESCRIPTION
    By default compiles every source asset for the addon (-r recursive over the content
    addon folder). Pass -InputPath to compile a single file (e.g. the arena map).

    resourcecompiler reads the source asset under content/dota_addons/<id>/ and writes the
    compiled *_c next to the game/dota_addons/<id>/ tree. Run tools/link-addon.ps1 first so
    the Dota folders point at this repo.

.PARAMETER DotaPath
    Path to the "dota 2 beta" install folder.

.PARAMETER InputPath
    Optional. A specific source asset to compile (absolute path, or relative to the
    content addon root). If omitted, the whole addon content folder is compiled recursively.

.EXAMPLE
    # Compile everything for the addon
    ./tools/compile.ps1

.EXAMPLE
    # Compile just the arena map
    ./tools/compile.ps1 -InputPath maps/arena.vmap
#>
[CmdletBinding()]
param(
    [string]$DotaPath = "C:\Program Files (x86)\Steam\steamapps\common\dota 2 beta",
    [string]$InputPath
)

$ErrorActionPreference = "Stop"
$addonId = "r3hab_pit_of_champions"

$rc = Join-Path $DotaPath "game\bin\win64\resourcecompiler.exe"
if (-not (Test-Path -LiteralPath $rc)) {
    throw "resourcecompiler.exe not found at $rc. Is the Dota 2 Workshop Tools DLC installed?"
}

$contentAddon = Join-Path $DotaPath "content\dota_addons\$addonId"

if ($InputPath) {
    # Resolve relative-to-content paths to absolute.
    if (-not [System.IO.Path]::IsPathRooted($InputPath)) {
        $InputPath = Join-Path $contentAddon $InputPath
    }
    if (-not (Test-Path -LiteralPath $InputPath)) {
        throw "Input asset not found: $InputPath"
    }
    Write-Host "Compiling: $InputPath" -ForegroundColor Cyan
    & $rc -i $InputPath
}
else {
    Write-Host "Compiling all addon content under: $contentAddon" -ForegroundColor Cyan
    & $rc -r -i (Join-Path $contentAddon "*")
}

if ($LASTEXITCODE -ne 0) {
    throw "resourcecompiler exited with code $LASTEXITCODE"
}
Write-Host "Compile complete." -ForegroundColor Green
