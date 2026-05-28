# restore-harness-deps.ps1
# Restaura os binarios necessarios para o harness funcionar
# (bun.exe e archon.exe).
#
# Tenta na ordem:
#   1. Restaurar do backup local em d:/tmp/harness-deps-backup-*
#   2. Re-downloadar do oficial (archon.diy + bun)

$ErrorActionPreference = "Stop"

$ProjectRoot = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$BunLocal = Join-Path $ProjectRoot ".archon/bin/bun.exe"
$ArchonGlobal = Join-Path $env:USERPROFILE ".archon/bin/archon.exe"

Write-Host "=== Harness Deps Restore ===" -ForegroundColor Cyan
Write-Host "Project root: $ProjectRoot"
Write-Host ""

# ----------------------------------------------------------------------------
# Step 1: bun.exe local em .archon/bin/
# ----------------------------------------------------------------------------

if (Test-Path $BunLocal) {
    $size = (Get-Item $BunLocal).Length / 1MB
    Write-Host "[ok] bun.exe ja existe em .archon/bin/ ($([math]::Round($size,1)) MB)" -ForegroundColor Green
} else {
    Write-Host "[..] Procurando bun.exe em backup local..."
    $backup = Get-ChildItem "d:/tmp/harness-deps-backup-*" -ErrorAction SilentlyContinue |
              Sort-Object LastWriteTime -Descending |
              Select-Object -First 1

    if ($backup -and (Test-Path "$($backup.FullName)/bun.exe")) {
        New-Item -ItemType Directory -Path (Split-Path $BunLocal) -Force | Out-Null
        Copy-Item "$($backup.FullName)/bun.exe" $BunLocal
        Write-Host "[ok] bun.exe restaurado de $($backup.FullName)" -ForegroundColor Green
    } else {
        Write-Host "[!!] Backup nao encontrado. Tentando re-download via reflex/bun (ou bun upgrade)..."
        # Path-resolved bun (caso usuario tenha em outro lugar)
        $existing = Get-Command bun.exe -ErrorAction SilentlyContinue
        if ($existing) {
            New-Item -ItemType Directory -Path (Split-Path $BunLocal) -Force | Out-Null
            Copy-Item $existing.Path $BunLocal
            Write-Host "[ok] bun.exe copiado de $($existing.Path)" -ForegroundColor Green
        } else {
            Write-Host "[!!] bun.exe nao achado no PATH. Instale via: irm bun.sh/install.ps1 | iex" -ForegroundColor Yellow
        }
    }
}

# ----------------------------------------------------------------------------
# Step 2: archon.exe global em ~/.archon/bin/
# ----------------------------------------------------------------------------

if (Test-Path $ArchonGlobal) {
    $size = (Get-Item $ArchonGlobal).Length / 1MB
    Write-Host "[ok] archon.exe ja existe em ~/.archon/bin/ ($([math]::Round($size,1)) MB)" -ForegroundColor Green
} else {
    Write-Host "[..] Procurando archon.exe em backup local..."
    $backup = Get-ChildItem "d:/tmp/harness-deps-backup-*" -ErrorAction SilentlyContinue |
              Sort-Object LastWriteTime -Descending |
              Select-Object -First 1

    if ($backup -and (Test-Path "$($backup.FullName)/archon.exe")) {
        New-Item -ItemType Directory -Path (Split-Path $ArchonGlobal) -Force | Out-Null
        Copy-Item "$($backup.FullName)/archon.exe" $ArchonGlobal
        Write-Host "[ok] archon.exe restaurado de $($backup.FullName)" -ForegroundColor Green

        # Garantir que ta no PATH
        $userPath = [Environment]::GetEnvironmentVariable("PATH", "User")
        $archonBinDir = Split-Path $ArchonGlobal
        if ($userPath -notlike "*$archonBinDir*") {
            [Environment]::SetEnvironmentVariable("PATH", "$userPath;$archonBinDir", "User")
            Write-Host "[ok] Adicionado $archonBinDir ao User PATH (abra novo terminal pra usar)" -ForegroundColor Green
        }
    } else {
        Write-Host "[!!] Backup nao encontrado. Tentando re-instalar via archon.diy..."
        try {
            Invoke-RestMethod https://archon.diy/install.ps1 | Invoke-Expression
            Write-Host "[ok] archon instalado via archon.diy" -ForegroundColor Green
        } catch {
            Write-Host "[!!] Falha ao instalar Archon. Manual: irm https://archon.diy/install.ps1 | iex" -ForegroundColor Yellow
        }
    }
}

# ----------------------------------------------------------------------------
# Step 3: Verifica
# ----------------------------------------------------------------------------

Write-Host ""
Write-Host "=== Verificacao ===" -ForegroundColor Cyan

if (Test-Path $BunLocal) {
    $v = & $BunLocal --version 2>&1
    Write-Host "[ok] bun: $v"
}

if (Test-Path $ArchonGlobal) {
    $v = & $ArchonGlobal --version 2>&1 | Select-Object -First 1
    Write-Host "[ok] archon: $v"
}

Write-Host ""
Write-Host "Pronto. Teste com: archon workflow list" -ForegroundColor Cyan
