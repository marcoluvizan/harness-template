# Harness — Spektor-compatible Open Implementation

Implementacao aberta do padrao **Harness Engineering** apresentado por Felipe Rodrigues no workshop Tech Leads Club IA Avancado (2026), construida em cima do [Archon](https://github.com/coleam00/Archon) (engine de workflows YAML em git worktree isolado).

> **Spektor e fechado e em construcao.** Esta implementacao segue os mesmos 7 Pilares publicos da palestra + os 5 Focos de Governanca do Waldemar Neto, sem ser bit-a-bit identica ao produto dele.

## Tese central

**O modelo e commodity, o harness e a vantagem competitiva.**

Comparar dois agentes nao e comparar modelos. E comparar harnesses.

## Os 7 Pilares (implementados)

| # | Pilar | Onde mora |
|---|---|---|
| 1 | Spec-Driven Execution (SDD) | `.archon/workflows/sdd-task.yaml` + `.archon/commands/specify\|design\|tasks\|execute.md` |
| 2 | Coordenacao (Pilot + Orchestrator) | `.archon/workflows/*` (orchestrator = Archon) + sdd-task como pilot |
| 3 | Verification & Judge | `.archon/scripts/judge.ts` + `.archon/commands/judge.md` |
| 4 | Completion Gates em cascata | `.archon/scripts/{file_integrity,change_sufficiency,embedding_filter,judge}.ts` |
| 5 | Guardrails | `.archon/scripts/{cost_cap,file_integrity}.ts` |
| 6 | Resiliencia | `.archon/scripts/stall_detector.ts` + Archon resume/retry |
| 7 | Observabilidade + Cognition Lessons | `events/` (event store) + `lessons/` (regras geradas) |
| Bonus | Sandbox | subprocess + ai-jail (TODO microVM) |

## Quickstart

### Setup (ja feito no projeto SemanaIA)

```powershell
# 1. Pre-requisitos
#    - Claude Code instalado e autenticado (Pro Max)
#    - bun >= 1.3.0 (rodou: bun upgrade)
#    - git repo inicializado no projeto onde for usar

# 2. Archon do source clonado em docs/cursos/.../repos/Archon/
#    Ja foi rodado: bun install la dentro

# 3. .archon/ ja copiado pra raiz do projeto (com workflows + scripts + commands)

# 4. archon.cmd (wrapper) na raiz aponta pra bun run cli do source
```

### Uso

```powershell
# Listar workflows disponiveis (23 total: 20 bundled + 3 customizados)
.\archon workflow list

# Validar configuracao
.\archon doctor

# Rodar workflow customizado SDD
.\archon workflow run sdd-task "adicionar campo regional_office no cadastro"

# Rodar bug fix
.\archon workflow run fix-bug "fix validacao CPF vazio (#1234)"

# Review automatico de PR
$env:PR_ID="4521"; $env:REPO="bagre"; .\archon workflow run pr-review

# Ver runs ativos
.\archon workflow status

# Resumir run que falhou
.\archon workflow resume <run-id>
```

### Para chamar `archon` direto (sem `.\`)

Adicione `d:\Prototipos\SemanaIA` ao PATH:

```powershell
# Temporario (sessao atual)
$env:PATH = "$env:PATH;d:\Prototipos\SemanaIA"

# Permanente (User PATH)
[Environment]::SetEnvironmentVariable("PATH", "$env:PATH;d:\Prototipos\SemanaIA", "User")
```

Dai roda `archon ...` de qualquer projeto. O wrapper resolve cwd automaticamente.

### Auth

| Componente | Auth | Key separada? |
|---|---|---|
| Claude Code (VSCode) | sua sessao Pro Max | nao |
| Archon executando workflows | herda do `claude` subprocess | nao |
| `judge.ts` (refatorado) | `claude -p` CLI | nao |
| `embedding_filter.ts` | Voyage ou OpenAI | **sim, se ligado** (default OFF) |

Por padrao `embedding.enabled: false` no `config.yaml` — workflow funciona sem Voyage.

### Heads up: rodando dentro de Claude Code session

Archon detecta `CLAUDECODE=1` (variavel setada por sessoes Claude Code) e avisa que workflows podem travar (issue #1067). O wrapper ja seta `ARCHON_SUPPRESS_NESTED_CLAUDE_WARNING=1`. Para rodar workflows de verdade, **abra um terminal regular** (PowerShell/cmd fora do VSCode).

## Auth — quem precisa de key

| Componente | Auth | Key separada? |
|---|---|---|
| Claude Code (VSCode) | sua sessao Pro Max | nao |
| Archon executando workflows | herda do `claude` subprocess | nao |
| `judge.ts` (refatorado) | `claude -p` CLI | nao |
| `embedding_filter.ts` | Voyage ou OpenAI (provider externo) | **sim, se ligado** |

Por padrao `embedding.enabled: false` no `config.yaml` — sem key, workflow funciona normal, apenas vai direto pro Judge (mais caro mas operacional).

## Estrutura

```
harness/
|-- README.md                 # voce esta aqui
|-- PLAN.md                   # plano de implementacao em 3 fases
|-- docs/
|   |-- 7-pillars.md          # cada pilar detalhado
|   |-- governance.md         # 5 Focos do Waldemar
|   `-- compatibility.md      # vs Spektor (gap analysis)
|-- templates/                # copiado de awesome-harness-engineering
|   |-- AGENTS.md
|   |-- HARNESS_CHECKLIST.md
|   |-- PLAN.md
|   `-- IMPLEMENT.md
|-- .archon/
|   |-- workflows/            # Pilares 1, 2 (orquestracao)
|   |   |-- sdd-task.yaml     # SDD: SPECIFY -> DESIGN -> TASKS -> EXECUTE
|   |   |-- pr-review.yaml    # review de PR com judge
|   |   `-- fix-bug.yaml      # bug fix com file integrity
|   |-- scripts/              # Pilares 3, 4, 5, 6 (logica)
|   |   |-- cost_cap.ts
|   |   |-- judge.ts
|   |   |-- embedding_filter.ts
|   |   |-- file_integrity.ts
|   |   |-- change_sufficiency.ts
|   |   `-- stall_detector.ts
|   |-- commands/             # Prompts das fases SDD
|   |   |-- specify.md
|   |   |-- design.md
|   |   |-- tasks.md
|   |   |-- execute.md
|   |   `-- judge.md
|   `-- config.yaml           # cost_limit, thresholds, frozen_paths
|-- lessons/                  # Pilar 7: Cognition Lessons (regras geradas)
|   `-- README.md             # formato + exemplos
|-- events/                   # Pilar 7: event store auditavel
|   `-- (eventos JSONL, gitignored)
`-- examples/
    `-- add-cost-field-bagre.md
```

## Por que esse design

- **Plug-and-play** — copia a pasta `.archon/` pra qualquer projeto Sinapsis e funciona
- **Tudo em git** — workflows, prompts e scripts versionados; nao tem estado escondido
- **Local-first** — nao depende de SaaS, roda em qualquer laptop com Bun + Archon
- **Agent-agnostic** — Claude Code hoje, Codex amanha, Pi depois (via Archon)
- **Cost Cap default** — limite de R$ 10 por run, nao queima dinheiro acidentalmente

## Status (atualizado pós-validação real no TesteAneel)

| Componente | Status | Notas |
|---|---|---|
| Estrutura + docs | OK | tudo neste repo |
| Templates | OK | copiados literais do awesome-harness |
| SDD workflow | **OK (patched)** | 5 bugs corrigidos — ver `PRODUCTION_READINESS.md` |
| Cost Cap | OK | validado: R$ 2/run MEDIUM, cap funcional |
| Judge | OK | validado: 4 fases, lessons quando falha |
| File Integrity | OK | validado: spec/design/tasks congelados |
| Change Sufficiency | OK | gate roda mas não foi exercitado a ponto de falhar |
| Embedding Filter | OK (off default) | precisa VOYAGE_API_KEY pra ativar |
| Stall Detector | **NÃO TESTADO** | nunca disparou em uso real |
| Cognition Lessons | **OK (validado)** | gerou lesson de qualidade real quando judge falhou |
| Portabilidade | **OK** | walk-up de `$PWD` pra achar `.git`, sem hardcode |
| Gates por stack | **OK** | Maven + Node + Python + Gradle suportados |
| microVM sandbox | OUT | fora de escopo, fica subprocess+ai-jail |

**Pra drop-in em novo projeto:** leia [`PRODUCTION_READINESS.md`](PRODUCTION_READINESS.md).

## Proximos passos

1. **Validar em 1 projeto Sinapsis pequeno** (TesteAneel sugerido)
2. **Medir** baseline (tempo de review, custo medio por task) vs com harness
3. **Iterar** thresholds do judge + valores de cost cap
4. **Promover** Cognition Lessons recorrentes pra memoria de time

Ver `PLAN.md` pro roteiro completo em 3 fases.

## Atribuicao

- **Felipe Rodrigues** (BHub.ai) — 7 Pilares de Harness Engineering
- **Waldemar Neto** (Tech Leads Club) — 5 Focos de Governanca + Context Engineering
- **William Fernandes** (PayPal) — patterns de operacao diaria
- **Anthropic** — Effective Harnesses for Long-Running Agents
- **Birgitta Bockeler** (Thoughtworks/Martin Fowler) — Harness Engineering for Coding Agent Users
- **ai-boost/awesome-harness-engineering** — templates base
- **coleam00/Archon** — workflow engine

Workshop original: Tech Leads Club IA Avancado 2a Edicao (Maio 2026).
