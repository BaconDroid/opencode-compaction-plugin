# opencode-compaction-plugin installer for Windows
#
# Usage:
#   irm https://raw.githubusercontent.com/BaconDroid/opencode-compaction-plugin/master/install.ps1 | iex
#   # or from a local clone:
#   .\install.ps1
#   .\install.ps1 C:\path\to\project
#
param(
    [string]$TargetDir = "."
)

$ErrorActionPreference = "Stop"

# Resolve target
$TargetDir = (Resolve-Path $TargetDir).Path
$PluginDir = Join-Path $TargetDir ".opencode\plugins\compaction"
$PluginBase = Join-Path $TargetDir ".opencode\plugins"
$EntryFile = Join-Path $PluginBase "compaction.ts"

Write-Host "[info]  Installing opencode-compaction-plugin into $TargetDir" -ForegroundColor Cyan

# Locate source files
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$SrcDir = ""

if (Test-Path (Join-Path $ScriptDir "src\index.ts")) {
    $SrcDir = Join-Path $ScriptDir "src"
} else {
    Write-Host "[info]  Downloading from GitHub..." -ForegroundColor Cyan
    $TmpDir = Join-Path $env:TEMP "opencode-compaction-plugin-$(Get-Random)"
    git clone --depth 1 https://github.com/BaconDroid/opencode-compaction-plugin.git "$TmpDir" 2>$null
    if ($LASTEXITCODE -ne 0) {
        Write-Host "[error] Failed to clone repository" -ForegroundColor Red
        exit 1
    }
    $SrcDir = Join-Path $TmpDir "src"
}

if (-not (Test-Path $SrcDir)) {
    Write-Host "[error] Source directory not found" -ForegroundColor Red
    exit 1
}

# Create plugin directory
New-Item -ItemType Directory -Path $PluginDir -Force | Out-Null

# Copy the source tree (preserve core/, config/, opencode/)
$sources = Get-ChildItem -Path $SrcDir -Filter "*.ts" -File -Recurse
if ($sources.Count -eq 0) {
    Write-Host "[error] No TypeScript sources found in $SrcDir" -ForegroundColor Red
    exit 1
}
Copy-Item -Path (Join-Path $SrcDir "*") -Destination $PluginDir -Recurse -Force

$installed = (Get-ChildItem -Path $PluginDir -Filter "*.ts" -File -Recurse).Count
Write-Host "[ok]    Plugin installed to $PluginDir\ ($installed TypeScript files)" -ForegroundColor Green

# Create entry point barrel file
# OpenCode scans .opencode/plugins/*.ts (not subdirs)
$barrelContent = '/** opencode-compaction-plugin entry point */' + [Environment]::NewLine + 'export { CompactionPlugin, default } from "./compaction/index.ts"' + [Environment]::NewLine
Set-Content -Path $EntryFile -Value $barrelContent -NoNewline
Write-Host "[ok]    Entry point: $EntryFile" -ForegroundColor Green

# Check opencode.json
$ConfigFile = Join-Path $TargetDir "opencode.json"
if (Test-Path $ConfigFile) {
    $content = Get-Content $ConfigFile -Raw
    if ($content -match "opencode-compaction-plugin") {
        Write-Host "[ok]    opencode.json already references the plugin" -ForegroundColor Green
    } else {
        Write-Host "[warn]  For npm-style loading, add to opencode.json:" -ForegroundColor Yellow
        Write-Host ""
        Write-Host '  { "plugin": ["opencode-compaction-plugin"] }'
        Write-Host ""
        Write-Host "[info]  Local plugin is already active - no config change needed." -ForegroundColor Cyan
    }
} else {
    Write-Host "[info]  No opencode.json found. The local plugin will be auto-loaded from .opencode\plugins\" -ForegroundColor Cyan
}

if ($TmpDir -and (Test-Path $TmpDir)) {
    Remove-Item -Recurse -Force $TmpDir
}

Write-Host ""
Write-Host "[ok]    Done! OpenCode will use the enhanced compaction prompt on next session." -ForegroundColor Green
