#Requires -Version 5.1
<#
.SYNOPSIS
  Instala o harness (.archon/ + harness/ + scripts/) em outro projeto.

.DESCRIPTION
  Copia o runtime do harness pra um projeto alvo, excluindo state/artifacts/logs
  do projeto fonte. Verifica pre-requisitos (git, archon, bun, claude) e
  roda 'archon doctor' no destino pra validar.

.PARAMETER TargetPath
  Caminho absoluto do projeto onde instalar (deve existir).

.PARAMETER Force
  Sobrescreve arquivos existentes no destino sem perguntar.

.PARAMETER SkipDoctor
  Pula o 'archon doctor' final.

.PARAMETER WithoutHarness
  Nao copia harness/ (so .archon/ runtime + scripts/).

.PARAMETER WithoutScripts
  Nao copia scripts/ (so .archon/ runtime + harness/).

.EXAMPLE
  .\scripts\install-into-project.ps1 -TargetPath c:\work\TesteAneel

.EXAMPLE
  .\scripts\install-into-project.ps1 -TargetPath c:\work\Bagre -Force -WithoutHarness
#>

[CmdletBinding()]
param(
    [Parameter(Mandatory = $true, Position = 0)]
    [string]$TargetPath,

    [switch]$Force,

    [switch]$SkipDoctor,

    [switch]$WithoutHarness,

    [switch]$WithoutScripts
)

$ErrorActionPreference = "Stop"

# ----------------------------------------------------------------------------
# Helpers
# ----------------------------------------------------------------------------

function Write-Step($Message) {
    Write-Host ""
    Write-Host "===> $Message" -ForegroundColor Cyan
}

function Write-OK($Message) {
    Write-Host "  [OK] $Message" -ForegroundColor Green
}

function Write-Warn($Message) {
    Write-Host "  [!!] $Message" -ForegroundColor Yellow
}

function Write-Fail($Message) {
    Write-Host "  [XX] $Message" -ForegroundColor Red
}

function Test-CommandExists($Name) {
    $null -ne (Get-Command $Name -ErrorAction SilentlyContinue)
}

# ----------------------------------------------------------------------------
# Resolve source root
# ----------------------------------------------------------------------------

# Script vive em <repo>/scripts/, source root e o pai
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$SourceRoot = Split-Path -Parent $ScriptDir

Write-Host ""
Write-Host "================================================================" -ForegroundColor Cyan
Write-Host "  Harness Install" -ForegroundColor Cyan
Write-Host "================================================================" -ForegroundColor Cyan
Write-Host "  Source: $SourceRoot"
Write-Host "  Target: $TargetPath"
Write-Host ""

# ----------------------------------------------------------------------------
# Step 1 — Validate target
# ----------------------------------------------------------------------------

Write-Step "Step 1: Validacao do destino"

if (-not (Test-Path $TargetPath -PathType Container)) {
    Write-Fail "Diretorio destino nao existe: $TargetPath"
    Write-Host "       Crie primeiro: mkdir '$TargetPath'"
    exit 1
}
Write-OK "Diretorio existe"

# Git repo check
$gitDir = Join-Path $TargetPath ".git"
if (Test-Path $gitDir) {
    Write-OK "Git repo detectado"
}
else {
    Write-Warn "NAO eh git repo. Archon requer git pra detectar project root."
    Write-Warn "Sugestao: cd '$TargetPath'; git init -b main; git commit --allow-empty -m 'init'"
}

# Conflict check
$ArchonTarget = Join-Path $TargetPath ".archon"
if ((Test-Path $ArchonTarget) -and -not $Force) {
    Write-Fail ".archon/ ja existe em $TargetPath. Use -Force pra sobrescrever."
    exit 2
}

# ----------------------------------------------------------------------------
# Step 2 — Pre-requisitos globais
# ----------------------------------------------------------------------------

Write-Step "Step 2: Pre-requisitos globais"

$MissingDeps = @()

if (Test-CommandExists "archon") {
    $v = (& archon --version 2>&1 | Select-Object -First 1)
    Write-OK "archon: $v"
}
else {
    $archonBin = Join-Path $env:USERPROFILE ".archon\bin\archon.exe"
    if (Test-Path $archonBin) {
        Write-Warn "archon.exe existe em $archonBin mas nao esta no PATH"
        Write-Warn "Reinicie o terminal ou: \$env:PATH += `";\$env:USERPROFILE\.archon\bin`""
    }
    else {
        $MissingDeps += "archon (instale: irm https://archon.diy/install.ps1 | iex)"
    }
}

if (Test-CommandExists "bun") {
    $v = (& bun --version 2>&1)
    Write-OK "bun: $v"
}
else {
    $MissingDeps += "bun (instale: irm bun.sh/install.ps1 | iex)"
}

if (Test-CommandExists "claude") {
    $v = (& claude --version 2>&1 | Select-Object -First 1)
    Write-OK "claude CLI: $v"
}
else {
    $MissingDeps += "claude CLI (instale Claude Code: https://claude.com/claude-code)"
}

if (Test-CommandExists "git") {
    Write-OK "git: presente"
}
else {
    $MissingDeps += "git (instale: https://git-scm.com)"
}

if ($MissingDeps.Count -gt 0) {
    Write-Host ""
    Write-Fail "Faltam pre-requisitos:"
    $MissingDeps | ForEach-Object { Write-Host "       - $_" -ForegroundColor Red }
    Write-Host ""
    Write-Host "       Instale o que faltar e rode de novo." -ForegroundColor Yellow
    exit 3
}

# ----------------------------------------------------------------------------
# Step 3 — Copy .archon (runtime)
# ----------------------------------------------------------------------------

Write-Step "Step 3: Copiando .archon/ (runtime)"

$Source = Join-Path $SourceRoot ".archon"
if (-not (Test-Path $Source)) {
    Write-Fail ".archon/ nao existe em $SourceRoot. Esse script nao esta na raiz do harness?"
    exit 4
}

# Usa robocopy pra excluir state/artifacts/logs (runtime do projeto fonte)
$RoboArgs = @(
    $Source,
    $ArchonTarget,
    "/E",          # subdirs (incluindo vazios)
    "/XD", "state", "artifacts", "logs",  # exclui esses dirs
    "/XF", "*.tmp", "*.log",              # exclui arquivos temporarios
    "/NFL", "/NDL", "/NJH", "/NJS",       # output enxuto
    "/NP"                                 # sem progresso barra
)

if ($Force) { $RoboArgs += "/PURGE" }

& robocopy @RoboArgs | Out-Null
$rcArchon = $LASTEXITCODE

# robocopy: 0,1,2,3 = sucesso (sem ou com diferencas/copiados)
if ($rcArchon -lt 4) {
    $fileCount = (Get-ChildItem $ArchonTarget -Recurse -File | Measure-Object).Count
    Write-OK ".archon/ copiado ($fileCount arquivos, state/artifacts/logs excluidos)"
}
else {
    Write-Fail "robocopy falhou (exit $rcArchon)"
    exit 5
}

# Verifica bun.exe (94MB, deve estar em .archon/bin/)
$BunTarget = Join-Path $ArchonTarget "bin\bun.exe"
if (Test-Path $BunTarget) {
    $sizeMB = [math]::Round((Get-Item $BunTarget).Length / 1MB, 1)
    Write-OK "bun.exe presente em .archon/bin/ ($sizeMB MB)"
}
else {
    Write-Warn "bun.exe nao foi copiado (talvez fonte nao tinha). Workflows vao falhar ate copiar."
    Write-Warn "Fix: copie de \$env:USERPROFILE\AppData\Local\reflex\bun\bin\bun.exe ou rode bun upgrade"
}

# ----------------------------------------------------------------------------
# Step 4 — Copy harness/ (opcional, docs)
# ----------------------------------------------------------------------------

if (-not $WithoutHarness) {
    Write-Step "Step 4: Copiando harness/ (docs + templates + examples)"
    $HarnessSource = Join-Path $SourceRoot "harness"
    $HarnessTarget = Join-Path $TargetPath "harness"

    if (Test-Path $HarnessSource) {
        & robocopy $HarnessSource $HarnessTarget /E /NFL /NDL /NJH /NJS /NP | Out-Null
        if ($LASTEXITCODE -lt 4) {
            $fileCount = (Get-ChildItem $HarnessTarget -Recurse -File | Measure-Object).Count
            Write-OK "harness/ copiado ($fileCount arquivos)"
        }
        else {
            Write-Warn "harness/ falhou ao copiar (exit $LASTEXITCODE)"
        }
    }
    else {
        Write-Warn "harness/ nao existe na fonte, pulando"
    }
}
else {
    Write-Host "  [--] Pulando harness/ (-WithoutHarness)"
}

# ----------------------------------------------------------------------------
# Step 5 — Copy scripts/ (opcional, ops)
# ----------------------------------------------------------------------------

if (-not $WithoutScripts) {
    Write-Step "Step 5: Copiando scripts/ (backup/restore/setup)"
    $ScriptsSource = Join-Path $SourceRoot "scripts"
    $ScriptsTarget = Join-Path $TargetPath "scripts"

    if (Test-Path $ScriptsSource) {
        & robocopy $ScriptsSource $ScriptsTarget /E /NFL /NDL /NJH /NJS /NP | Out-Null
        if ($LASTEXITCODE -lt 4) {
            $fileCount = (Get-ChildItem $ScriptsTarget -Recurse -File | Measure-Object).Count
            Write-OK "scripts/ copiado ($fileCount arquivos)"
        }
        else {
            Write-Warn "scripts/ falhou ao copiar (exit $LASTEXITCODE)"
        }
    }
    else {
        Write-Warn "scripts/ nao existe na fonte, pulando"
    }
}
else {
    Write-Host "  [--] Pulando scripts/ (-WithoutScripts)"
}

# ----------------------------------------------------------------------------
# Step 6 — Sugestao de ajustes no config do destino
# ----------------------------------------------------------------------------

Write-Step "Step 6: Ajustes recomendados no .archon/config.yaml"
$DestConfig = Join-Path $TargetPath ".archon\config.yaml"

if (Test-Path $DestConfig) {
    $content = Get-Content $DestConfig -Raw

    # frozen_paths
    if ($content -match 'frozen_paths:') {
        Write-Warn "Revise 'file_integrity.frozen_paths' em $DestConfig"
        Write-Warn "  Atualmente referencia paths do projeto fonte (harness/**/*.md, etc)"
    }

    # cost.limit_brl
    if ($content -match 'limit_brl:\s*([0-9.]+)') {
        $limit = $Matches[1]
        Write-OK "cost.limit_brl: $limit BRL por run"
    }

    # worktree.baseBranch
    if ($content -notmatch 'worktree:[^#]*baseBranch:') {
        Write-Warn "Considere adicionar 'worktree.baseBranch: main' se o projeto nao tem remote 'origin'"
    }
}

# ----------------------------------------------------------------------------
# Step 7 — Doctor
# ----------------------------------------------------------------------------

if (-not $SkipDoctor) {
    Write-Step "Step 7: Executando 'archon doctor' no destino"

    Push-Location $TargetPath
    try {
        & archon doctor 2>&1 | ForEach-Object {
            if ($_ -match '^\[OK\]|^\[INFO\]|All checks passed') {
                Write-Host "  $_" -ForegroundColor Green
            }
            elseif ($_ -match '^\[!!\]|^\[ERR\]|warning|WARN') {
                Write-Host "  $_" -ForegroundColor Yellow
            }
            else {
                Write-Host "  $_"
            }
        }
    }
    finally {
        Pop-Location
    }
}
else {
    Write-Host "  [--] Pulando archon doctor (-SkipDoctor)"
}

# ----------------------------------------------------------------------------
# Summary
# ----------------------------------------------------------------------------

Write-Host ""
Write-Host "================================================================" -ForegroundColor Cyan
Write-Host "  Instalacao completa" -ForegroundColor Cyan
Write-Host "================================================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Para rodar o primeiro workflow:" -ForegroundColor White
Write-Host ""
Write-Host "  cd '$TargetPath'" -ForegroundColor White
Write-Host "  archon workflow list" -ForegroundColor White
Write-Host "  archon workflow run sdd-task --no-worktree 'task de teste'" -ForegroundColor White
Write-Host ""
Write-Host "Edite o config se necessario:"
Write-Host "  notepad '$DestConfig'"
Write-Host ""
