# backup-harness-deps.ps1
# Faz snapshot dos binarios necessarios pro harness fora do repo git.
#
# Backup em: d:/tmp/harness-deps-backup-<YYYY-MM-DD>/
#
# Por que fora do repo: bun.exe (94MB) + archon.exe (121MB) = 215MB, nao
# cabe em git. Restore via scripts/restore-harness-deps.ps1.

$ErrorActionPreference = "Stop"

$ProjectRoot = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$BunLocal = Join-Path $ProjectRoot ".archon/bin/bun.exe"
$ArchonGlobal = Join-Path $env:USERPROFILE ".archon/bin/archon.exe"

$Date = Get-Date -Format "yyyy-MM-dd"
$BackupDir = "d:/tmp/harness-deps-backup-$Date"

Write-Host "=== Harness Deps Backup ===" -ForegroundColor Cyan
Write-Host "Destino: $BackupDir"
Write-Host ""

New-Item -ItemType Directory -Path $BackupDir -Force | Out-Null

# bun.exe
if (Test-Path $BunLocal) {
    Copy-Item $BunLocal "$BackupDir/bun.exe" -Force
    $size = (Get-Item $BunLocal).Length / 1MB
    Write-Host "[ok] bun.exe ($([math]::Round($size,1)) MB)" -ForegroundColor Green
} else {
    Write-Host "[!!] $BunLocal nao existe" -ForegroundColor Yellow
}

# archon.exe
if (Test-Path $ArchonGlobal) {
    Copy-Item $ArchonGlobal "$BackupDir/archon.exe" -Force
    $size = (Get-Item $ArchonGlobal).Length / 1MB
    Write-Host "[ok] archon.exe ($([math]::Round($size,1)) MB)" -ForegroundColor Green
} else {
    Write-Host "[!!] $ArchonGlobal nao existe" -ForegroundColor Yellow
}

# VERSIONS.txt
$versions = @()
if (Test-Path $BunLocal) {
    $bv = & $BunLocal --version 2>&1
    $versions += "bun.exe v$bv (from $BunLocal)"
}
if (Test-Path $ArchonGlobal) {
    $av = & $ArchonGlobal --version 2>&1 | Select-Object -First 1
    $versions += "$av (from $ArchonGlobal)"
}
$versions += "Backup created: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')"
$versions | Out-File "$BackupDir/VERSIONS.txt" -Encoding utf8

Write-Host ""
Write-Host "=== Resumo ===" -ForegroundColor Cyan
Get-ChildItem $BackupDir | Select-Object Name, @{N='Size(MB)'; E={[math]::Round($_.Length/1MB,1)}}
Write-Host ""
Write-Host "Restore com: .\scripts\restore-harness-deps.ps1"
