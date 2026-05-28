<#
.SYNOPSIS
    Instala o harness Sinapsis (Archon + .archon/ + harness/) em um projeto novo ou existente.

.DESCRIPTION
    Faz drop-in da estrutura .archon/ + harness/ + .claude/settings.json a partir
    de um projeto-fonte (golden template). Mantém state per-project limpo,
    atualiza .gitignore, configura env vars e valida o setup.

    Idempotente: pode rodar várias vezes. Detecta install existente e oferece upgrade.

.PARAMETER Target
    Path do projeto destino. Default = diretório atual.

.PARAMETER Source
    Path do projeto fonte (golden template). Default = <set your golden template path>.
    Aceita também URL bitbucket: bb:sinapsis_sinapgrid/harness-template (TODO).

.PARAMETER Mode
    'fresh' = install limpo (apaga state existente)
    'upgrade' = atualiza .archon/workflows + scripts, preserva state/logs/artifacts
    Default = auto (detecta)

.PARAMETER SkipValidate
    Pula `archon doctor` final.

.PARAMETER Force
    Não pergunta confirmação em ações destrutivas.

.EXAMPLE
    .\install-harness.ps1
    # Instala no diretório atual usando TesteAneel como fonte

.EXAMPLE
    .\install-harness.ps1 -Target D:\Projetos\meu-projeto -Mode fresh -Force
    # Install limpo unattended

.EXAMPLE
    .\install-harness.ps1 -Mode upgrade
    # Só atualiza workflows/scripts, mantém runs anteriores

.NOTES
    Autor: <your name / your org>
    Validado em TesteAneel (mai/2026)
    Requer: PowerShell 5.1+, git, claude CLI, bun (vem no .archon/bin/)
#>

[CmdletBinding()]
param(
    [string]$Target = (Get-Location).Path,
    [string]$Source = '',
    [ValidateSet('fresh','upgrade','auto')]
    [string]$Mode = 'auto',
    [switch]$SkipValidate,
    [switch]$Force
)

# Auto-detect Source: usa $PSScriptRoot (dir do script) se ele tem .archon + harness.
# Caso contrário, fallback pra TesteAneel (referência inicial Sinapsis).
if ([string]::IsNullOrWhiteSpace($Source)) {
    $scriptDir = $PSScriptRoot
    if ((Test-Path "$scriptDir\.archon") -and (Test-Path "$scriptDir\harness")) {
        $Source = $scriptDir
    } elseif ((Test-Path "$scriptDir\..\.archon") -and (Test-Path "$scriptDir\..\harness")) {
        # Script está em harness/install-harness.ps1, source é o parent
        $Source = (Resolve-Path "$scriptDir\..").Path
    } else {
        $Source = "<set your golden template path>"  # fallback histórico
    }
}

$ErrorActionPreference = 'Continue'
$ProgressPreference = 'SilentlyContinue'

# Helper: roda comando nativo (git, etc) ignorando warnings/stderr, só checa exit code
function Invoke-Native {
    param([scriptblock]$Cmd, [string]$Label = 'cmd')
    $output = & $Cmd 2>&1
    if ($LASTEXITCODE -ne 0) {
        Write-Warn "$Label falhou (exit=$LASTEXITCODE): $output"
        return $false
    }
    return $true
}

# ============================================================================
# Helpers
# ============================================================================

function Write-Step  { param($msg) Write-Host "==> $msg" -ForegroundColor Cyan }
function Write-Ok    { param($msg) Write-Host "  [OK] $msg" -ForegroundColor Green }
function Write-Warn  { param($msg) Write-Host "  [WARN] $msg" -ForegroundColor Yellow }
function Write-Err   { param($msg) Write-Host "  [ERRO] $msg" -ForegroundColor Red }

function Confirm-Or-Exit {
    param([string]$Question, [string]$Default = 'n')
    if ($Force) { return $true }
    $resp = Read-Host "$Question [y/N]"
    if ([string]::IsNullOrWhiteSpace($resp)) { $resp = $Default }
    return $resp -match '^[Yy]'
}

# ============================================================================
# 1. Validar prerequisitos
# ============================================================================

Write-Step "Validando pré-requisitos"

$missing = @()
if (-not (Get-Command claude -ErrorAction SilentlyContinue)) { $missing += 'claude (Claude Code CLI)' }
if (-not (Get-Command git    -ErrorAction SilentlyContinue)) { $missing += 'git' }
if (-not (Get-Command archon -ErrorAction SilentlyContinue)) { $missing += 'archon (CLI do Archon)' }

if ($missing.Count -gt 0) {
    Write-Err "Faltam ferramentas no PATH: $($missing -join ', ')"
    Write-Host "  Instale antes de prosseguir:"
    Write-Host "    Claude Code: https://docs.claude.com/claude-code"
    Write-Host "    Archon:      https://github.com/coleam00/Archon"
    exit 1
}
Write-Ok "claude, git, archon disponíveis"

if (-not (Test-Path $Source)) { Write-Err "Source não existe: $Source"; exit 1 }
if (-not (Test-Path "$Source\.archon"))  { Write-Err "Source não parece ser harness: $Source\.archon ausente"; exit 1 }
if (-not (Test-Path "$Source\harness"))  { Write-Err "Source não parece ser harness: $Source\harness ausente"; exit 1 }
Write-Ok "Source válido: $Source"

if (-not (Test-Path $Target)) {
    if (-not (Confirm-Or-Exit "Target '$Target' não existe. Criar?")) { exit 1 }
    New-Item -ItemType Directory -Path $Target -Force | Out-Null
}
Write-Ok "Target: $Target"

# ============================================================================
# 2. Detectar Mode (auto)
# ============================================================================

$hasExisting = Test-Path "$Target\.archon\workflows"
if ($Mode -eq 'auto') {
    $Mode = if ($hasExisting) { 'upgrade' } else { 'fresh' }
    Write-Ok "Mode auto-detectado: $Mode"
}

if ($Mode -eq 'fresh' -and $hasExisting) {
    Write-Warn "Já existe .archon/ no target."
    if (-not (Confirm-Or-Exit "Sobrescrever (mode=fresh apaga state existente)?")) { exit 1 }
}

# ============================================================================
# 3. Git init (se necessário)
# ============================================================================

Write-Step "Verificando git no target"

Push-Location $Target
try {
    $isRepo = $false
    try {
        $null = git rev-parse --is-inside-work-tree 2>&1
        if ($LASTEXITCODE -eq 0) { $isRepo = $true }
    } catch { $isRepo = $false }
    if (-not $isRepo) {
        Write-Warn "Nao e repo git. Inicializando..."
        git init -b main --quiet 2>&1 | Out-Null
        git commit --allow-empty -m "init" --quiet 2>&1 | Out-Null
        Write-Ok "git init -b main"
    } else {
        Write-Ok "Repo git existente"
    }
}
finally { Pop-Location }

# ============================================================================
# 4. Copiar harness skeleton
# ============================================================================

Write-Step "Copiando harness do source"

# Backup .archon existente em upgrade
if ($Mode -eq 'upgrade' -and (Test-Path "$Target\.archon")) {
    $backup = "$Target\.archon.bak-$(Get-Date -Format 'yyyyMMdd-HHmmss')"
    Copy-Item -Recurse "$Target\.archon" $backup
    Write-Ok "Backup criado: $backup"
}

# Copia workflows + scripts + commands + config (sempre atualiza)
$itemsCore = @('workflows','scripts','commands','config.yaml','bin')
foreach ($item in $itemsCore) {
    $src = "$Source\.archon\$item"
    $dst = "$Target\.archon\$item"
    if (-not (Test-Path $src)) { Write-Warn "Source não tem .archon/$item, pulando"; continue }
    if (Test-Path $dst) { Remove-Item -Recurse -Force $dst }
    New-Item -ItemType Directory -Path (Split-Path $dst -Parent) -Force | Out-Null
    Copy-Item -Recurse $src $dst -Force
    Write-Ok ".archon/$item"
}

# Copia harness/ (docs, templates, etc) — só em fresh
if ($Mode -eq 'fresh' -or -not (Test-Path "$Target\harness")) {
    if (Test-Path "$Target\harness") { Remove-Item -Recurse -Force "$Target\harness" }
    Copy-Item -Recurse "$Source\harness" "$Target\harness" -Force
    # Remove state per-project que veio do source
    Remove-Item -Recurse -Force "$Target\harness\events\*","$Target\harness\lessons\*" -ErrorAction SilentlyContinue
    "" | Out-File "$Target\harness\events\.gitkeep" -NoNewline
    "" | Out-File "$Target\harness\lessons\.gitkeep" -NoNewline
    Write-Ok "harness/ (docs + templates)"
}

# .claude/settings.json — só copia se não existe
if (-not (Test-Path "$Target\.claude\settings.json")) {
    New-Item -ItemType Directory "$Target\.claude" -Force | Out-Null
    Copy-Item "$Source\.claude\settings.json" "$Target\.claude\settings.json"
    Write-Ok ".claude/settings.json (criado)"
} else {
    Write-Ok ".claude/settings.json (preservado)"
}

# ============================================================================
# 5. State per-project (fresh OU sempre cria estrutura vazia se ausente)
# ============================================================================

Write-Step "Preparando state per-project"

$stateDirs = @('.archon\state','.archon\logs','.archon\artifacts','events','lessons')
foreach ($d in $stateDirs) {
    $p = "$Target\$d"
    if ($Mode -eq 'fresh' -and (Test-Path $p)) { Remove-Item -Recurse -Force $p }
    if (-not (Test-Path $p)) { New-Item -ItemType Directory $p -Force | Out-Null }
}

# Cost cap zerado em fresh
if ($Mode -eq 'fresh') {
    '{"runs":{},"daily":{}}' | Out-File "$Target\.archon\state\cost.json" -Encoding utf8 -NoNewline
    Write-Ok "cost.json zerado"
}
Write-Ok "state dirs prontos"

# ============================================================================
# 6. .gitignore (idempotente)
# ============================================================================

Write-Step "Atualizando .gitignore"

$gitignorePath = "$Target\.gitignore"
if (-not (Test-Path $gitignorePath)) { New-Item -ItemType File $gitignorePath | Out-Null }

$marker = '# === Harness Sinapsis (managed by install-harness.ps1) ==='
$existing = Get-Content $gitignorePath -Raw -ErrorAction SilentlyContinue
if ($existing -and $existing.Contains($marker)) {
    Write-Ok ".gitignore já tem bloco do harness"
} else {
    $block = @"

$marker
# State per-project (não versionar)
.archon/state/
.archon/logs/
.archon/artifacts/
events/
lessons/*.yaml
!lessons/.gitkeep
# Paths corrompidos por bash WSL interpretando D:\ como literal Unicode
D[*
D*[*
# Backups do install-harness
.archon.bak-*/
# === fim Harness ===
"@
    Add-Content $gitignorePath $block
    Write-Ok ".gitignore: bloco do harness adicionado"
}

# ============================================================================
# 7. Env vars (idempotente)
# ============================================================================

Write-Step "Configurando env vars (User scope)"

$envCurrentClaude = [Environment]::GetEnvironmentVariable("CLAUDE_BIN_PATH","User")
if ([string]::IsNullOrWhiteSpace($envCurrentClaude)) {
    $claudePath = (Get-Command claude).Source
    [Environment]::SetEnvironmentVariable("CLAUDE_BIN_PATH",$claudePath,"User")
    Write-Ok "CLAUDE_BIN_PATH = $claudePath"
} else {
    Write-Ok "CLAUDE_BIN_PATH já setado: $envCurrentClaude"
}

if ([string]::IsNullOrWhiteSpace([Environment]::GetEnvironmentVariable("ARCHON_SUPPRESS_NESTED_CLAUDE_WARNING","User"))) {
    [Environment]::SetEnvironmentVariable("ARCHON_SUPPRESS_NESTED_CLAUDE_WARNING","1","User")
    Write-Ok "ARCHON_SUPPRESS_NESTED_CLAUDE_WARNING = 1"
}

# Aplica no processo atual também (pra archon doctor logo abaixo)
$env:CLAUDE_BIN_PATH = [Environment]::GetEnvironmentVariable("CLAUDE_BIN_PATH","User")
$env:ARCHON_SUPPRESS_NESTED_CLAUDE_WARNING = "1"

# ============================================================================
# 8. archon doctor
# ============================================================================

if (-not $SkipValidate) {
    Write-Step "Rodando archon doctor"
    Push-Location $Target
    try {
        $doctorOut = archon doctor 2>&1
        $doctorOut | ForEach-Object { Write-Host "  $_" }
        if ($LASTEXITCODE -ne 0) {
            Write-Warn "archon doctor reportou falha — investigue antes de usar"
        } else {
            Write-Ok "archon doctor passou"
        }
    }
    finally { Pop-Location }
}

# ============================================================================
# 9. Commit inicial do harness (se mode=fresh e working tree limpo)
# ============================================================================

Write-Step "Commit do harness no git"
Push-Location $Target
try {
    git add .archon harness .claude .gitignore 2>&1 | Out-Null
    $hasChanges = (git status --porcelain | Measure-Object).Count -gt 0
    if ($hasChanges) {
        $sourceLeaf = Split-Path $Source -Leaf
        $commitMsg = "harness: drop-in inicial via install-harness.ps1 (source: $sourceLeaf)"
        git commit -m $commitMsg --quiet 2>&1 | Out-Null
        Write-Ok "Commit criado"
    } else {
        Write-Ok "Nada novo pra commitar"
    }
}
finally { Pop-Location }

# ============================================================================
# 10. Resumo + próximos passos
# ============================================================================

Write-Host ""
Write-Host "============================================================" -ForegroundColor Green
Write-Host " Harness instalado com sucesso (mode=${Mode})" -ForegroundColor Green
Write-Host "============================================================" -ForegroundColor Green
Write-Host ""
Write-Host "Próximos passos:" -ForegroundColor Cyan
Write-Host "  1. Leia: $Target\harness\PRODUCTION_READINESS.md"
Write-Host "  2. Liste workflows:   archon workflow list"
Write-Host "  3. Primeira task (sempre SMALL pra economizar):"
Write-Host "       cd `"$Target`""
Write-Host "       archon workflow run sdd-task --no-worktree `"<sua task>`""
Write-Host ""
Write-Host "Configurações recomendadas para produção (.archon/config.yaml):"
Write-Host "  - cost.limit_brl: 5  (atual default: 10)"
Write-Host "  - judge.threshold: 0.85  (atual: 0.7)"
Write-Host "  - judge.policy_on_fail: HALT  (atual: RETRY)"
Write-Host ""
$costStatus = if ($Mode -eq 'fresh') { 'zerado' } else { 'preservado' }
Write-Host "Cost cap inicial: $costStatus"
Write-Host ""
