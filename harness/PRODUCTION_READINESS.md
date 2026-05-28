# Harness Production Readiness — Lições do TesteAneel

> Resultado de validação real em your project (TesteAneel) com 5 auditorias + 4 runs de `sdd-task` de complexidade variada. Documento de referência pra drop-in em novos projetos.

## TL;DR

- **7 Pilares funcionam** quando o pipeline roda inteiro (MEDIUM+)
- **Bugs do framework eram reais** — 5 corrigidos nesta validação (commit history em `D:\Prototipos\TesteAneel\.archon\workflows\sdd-task.yaml`)
- **Patches aplicados são portáveis** (sem hardcode de path)
- **Custo médio por task MEDIUM**: ~R$ 2 (judge_specify + judge_design + judge_tasks + judge_final)

## Patches aplicados no `sdd-task.yaml`

| Bug original | Sintoma | Fix |
|---|---|---|
| `AND` em vez de `&&` na expressão `when:` | Workflow "completed successfully" pulando DESIGN/TASKS silenciosamente | Substituir por `&&` (sintaxe Archon) |
| Classificação TRIVIAL pula 17/20 nodes | Workflow vira no-op, código não é escrito, mas exit 0 | Remover TRIVIAL do auto-sizing — SMALL é mínimo |
| SMALL com cascade-skip por dependência | `tasks` depends_on `judge_design`, judge_design skipped em SMALL → tudo cascateia | `design` + `judge_design` sempre rodam (custa R$0.50 extra) |
| `gate_judge_final` usa `git diff main` rodando em main | Diff vazio → judge dá score 0 → falsa reprovação | Captura `START_SHA` em `identity_log`, diff contra ele |
| `git rev-parse HEAD` retorna vazio em alguns shells | `start-sha.txt` vazio → `git diff ""` falha | Walk up de `$PWD` até achar `.git`, usar `git -C` |
| `gate_tests` só conhecia npm/pytest | Projetos Maven não tinham gate funcional | Detecta `pom.xml` → `mvnd test`; idem Gradle |
| Path hardcoded `D:/Prototipos/TesteAneel` | Portabilidade zero | Substituído por walk-up bash function |

## Pré-requisitos pra drop-in em novo projeto

```powershell
# 1. Estrutura
# Copie .archon/ + harness/ pra raiz do novo projeto
# (NÃO copie .archon/state/, .archon/logs/, .archon/artifacts/ — são per-project)

# 2. Git init obrigatório
cd <projeto>
git init -b main
git commit --allow-empty -m "init"

# 3. CLAUDE_BIN_PATH (user env)
[Environment]::SetEnvironmentVariable("CLAUDE_BIN_PATH", (Get-Command claude).Source, "User")

# 4. Suprimir warning do nested Claude Code
[Environment]::SetEnvironmentVariable("ARCHON_SUPPRESS_NESTED_CLAUDE_WARNING", "1", "User")

# 5. Verificar
archon doctor
archon workflow list

# 6. Configurar settings.json com permissões amplas (ver TesteAneel/.claude/settings.json)

# 7. Rodar com prompt explícito (auto_size classifica SMALL/MEDIUM/LARGE)
archon workflow run sdd-task --no-worktree "<descrição da task>"
```

## Configurações por stack

### Java/Maven (testado no TesteAneel)
- `gate_tests` detecta `pom.xml` e roda `mvnd test -q`
- `gate_lint` busca por `spotless-maven-plugin` ou `maven-checkstyle-plugin`; se ausente, pula
- `mvnd.cmd` deve estar no PATH (ou `mvn` como fallback)
- `JAVA_HOME` apontando para JDK 17+

### Node/Vue/React (validado parcialmente)
- `gate_tests` detecta `package.json` com `"test"` script
- `gate_lint` detecta `"lint"` script
- `npm` no PATH

### Python (não testado neste projeto)
- `gate_tests`: `pyproject.toml` + `pytest` instalado
- `gate_lint`: `ruff` instalado

### Outros (Go, Rust, etc.)
- Editar `gate_lint`/`gate_tests` em `.archon/workflows/sdd-task.yaml`

## Configurações recomendadas em produção (`.archon/config.yaml`)

```yaml
cost:
  limit_brl: 5.00          # menor que default 10 — limita blast radius
  daily_limit_brl: 30.00   # menor que default 50
  warn_at_percent: 70

judge:
  threshold: 0.85          # maior que default 0.7 — menos falsos positivos
  max_retries: 2
  policy_on_fail: "HALT"   # em vez de RETRY: para na 1a falha real

file_integrity:
  frozen_paths:
    - "harness/**/*.md"
    - "$ARTIFACTS_DIR/spec.md"
    - "$ARTIFACTS_DIR/design.md"
    - "$ARTIFACTS_DIR/tasks.json"
    # Adicione paths críticos do projeto:
    - "src/main/resources/application.yml"
    - ".github/**"
    - "Dockerfile"
```

## Riscos conhecidos (NÃO use sem mitigar)

| Risco | Severidade | Mitigação obrigatória |
|---|---|---|
| Hallucination de "tests pass" | 🔴 | Garantir `gate_tests` adaptado pra stack do projeto (não pulará) |
| Race entre execute_loop e edição humana | 🟠 | Sempre `--worktree` (não `--no-worktree`) em projetos compartilhados |
| Auto-merge sem review | 🔴 | `human_approval` deve ficar habilitado; nunca remover do YAML |
| Path corruption Windows/POSIX | 🟡 | Rodar em WSL ou Linux quando possível |
| Spec poisoning | 🟠 | Code review humano em 100% dos PRs |
| Lesson promotion errada | 🟡 | Auditar `lessons/` periodicamente antes de promover |

## Validação mínima antes de promover pra outros projetos

1. ✅ `archon doctor` passa
2. ✅ `archon workflow list` mostra `sdd-task`
3. ✅ Rodar `sdd-task` em task SMALL real — esperar `auto_size=SMALL`, ver pipeline completa
4. ✅ Rodar em task MEDIUM — confirmar todos 20 nodes
5. ✅ Confirmar `cost.json` com deltas por judge
6. ✅ Confirmar lesson gerada em `lessons/` quando gate falha
7. ✅ Confirmar `gate_tests` ROUDOU `mvnd test`/`npm test`/`pytest` (não skipou)
8. ✅ Confirmar `human_approval` aparece (não auto-skipa)

## O que NÃO foi validado (gaps abertos)

- ⚠️ `stall_detector` (Pilar 6): nunca disparou
- ⚠️ `fallback_chain` haiku→sonnet→opus: nunca disparou
- ⚠️ `embedding_filter`: desligado por default
- ⚠️ Lesson auto-promote após 3 ocorrências: não testado
- ⚠️ Multi-dev concorrente: não testado
- ⚠️ Integração CI (Bitbucket Pipelines): não testado
- ⚠️ Tarefas LARGE (> 300 linhas): não testado

## Custos observados (Maio 2026, claude-opus-4-7)

| Run | Tipo | Cost | Nodes que rodaram |
|---|---|---|---|
| #1 | SMALL (com bug AND→&&) | R$ 0.82 | só specify + judge_specify |
| #2 | TRIVIAL (no-op) | R$ 0 | só identity + cost_cap + auto_size |
| #3 | MEDIUM | R$ 2.07 | pipeline completa exceto create_pr |
| #4 | SMALL pós-fix | R$ ~1.50 | pipeline completa exceto create_pr |
| **Média MEDIUM** | | **~R$ 2** | |

Para 50 tasks MEDIUM/mês: ~R$ 100/mês por dev. Cabe em typical engineering budget.

## Roadmap pra v2

- [ ] Configurar `embedding_filter` com Voyage (corta 30% dos judges, reduz custo)
- [ ] Adicionar `human_approval` skip controlado por env var (`SKIP_APPROVAL=1` pra CI)
- [ ] Webhook Bitbucket → `pr-review` workflow
- [ ] Validar `stall_detector` provocando stall artificial
- [ ] Lessons → memória de time (auto-promote)
- [ ] Stress test multi-dev concorrente
- [ ] Validar `create_pr` end-to-end com `git push origin <branch>` antes de chamar Bitbucket API

## Gotchas descobertos na validação real (TesteAneel, mai/2026)

### 1. Archon pré-substitui `$VARNAME` no bash template
**Sintoma:** vars bash locais viram string vazia.
**Solução:** inline tudo via `$(cat events/$WORKFLOW_ID-<file>.txt)`. Apenas `$WORKFLOW_ID` e `$ARGUMENTS` sobrevivem.

### 2. Bash do Archon roda em WSL2 Ubuntu (não MSYS)
**Sintoma:** paths Windows (`D:\Prototipos\...`) viram `D[U+F03A][U+F05C]Prototipos...` ou `D:Prototipos.archon...` (bashes diferentes).
**Solução:** sed `D:\` → `/mnt/d/`, ou `git rev-parse --show-toplevel` que retorna POSIX correto.

### 3. Classificação `TRIVIAL` bypassa tudo
**Sintoma:** workflow "completed" mas execute_loop e gates não rodam.
**Solução:** removido TRIVIAL do prompt do `auto_size`. SMALL é mínimo.

### 4. Cascade-skip por dependência
**Sintoma:** quando `judge_design` é skipado por `when:`, todo o subgrafo dependente também skipa (mesmo com `when:` próprio aprovando).
**Solução:** fazer design + judge_design sempre rodarem (custo extra ~R$ 0,50, mas pipeline consistente).

### 5. `gate_judge_final` recebia diff vazio
**Sintoma:** rodando em `main`, `git diff main` retorna vazio → score 0 → falsa reprovação.
**Solução:** `identity_log` captura `git rev-parse HEAD` em arquivo; gates leem via `cat`.

### 6. `gate_tests` só conhecia npm/pytest
**Sintoma:** projetos Maven viam "no test config found, skipping" — gate inútil.
**Solução:** adicionada detecção de `pom.xml` → `mvnd test -q`; Gradle idem.

### 7. `create_pr` assumia GitHub + `gh` CLI
**Sintoma:** teams that use Bitbucket → comando falha.
**Solução:** create_pr agora detecta provider (gh/bitbucket-api/skip graceful), com fallback a Bitbucket API via `~/.bitbucket_token`.

### 8. `file_integrity` pega modificações não-committed do dev
**Sintoma:** dev edita arquivo durante workflow → gate bloqueia (correto em CI, atrapalha em dev local).
**Recomendação:** commitar working tree ANTES de rodar `sdd-task`, ou usar `--worktree` (isolamento real).

### 9. Path corruption ao usar `del`/`rm` com wildcards em Windows
**Sintoma:** `del D*` recursivo pega TODOS arquivos com prefixo D — incluindo `.git/objects/D*`, libs como `DashboardView`, `data.js`, etc.
**Recomendação:** **JAMAIS** usar wildcards genéricos pra limpar artefatos. Listar paths explícitos ou usar gitignore.
