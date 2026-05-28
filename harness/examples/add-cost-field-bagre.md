# Exemplo: Adicionar campo `regional_office` no cadastro do Bagre

> Caso de uso real para ilustrar o workflow SDD ponta-a-ponta. Voce pode usar como guia ou template.

## Contexto

- **Projeto:** Bagre (sistema interno the team)
- **Tarefa Teamwork:** #2341 - "Adicionar regional_office ao cadastro de cliente"
- **Branch convencao:** `feature/2341-add-regional-office`
- **Estimativa:** small (~50 linhas em 3 arquivos)

## Como invocar

```bash
cd ~/work/bagre
archon run sdd-task "adicionar campo regional_office no cadastro de cliente (task #2341)"
```

## O que acontece (fluxo real)

### Step 0 — Identity log + Cost Cap init (10ms)
```
events/run-abc123-start.jsonl:
{"event":"agent_session_started","run_id":"abc123","owner":"marco.luvizan","task":"adicionar campo..."}
{"event":"cost_cap_initialized","run_id":"abc123","limit_brl":10.0}
```

### Step 1 — Auto-sizing (5s, $0.001)
Modelo classifica: **SMALL** (estimou 30-80 linhas).
SDD pula DESIGN explicito (small -> skip design phase), mas mantem SPECIFY e TASKS.

### Step 2 — SPECIFY (45s, $0.02)
Modelo escreve `$ARTIFACTS_DIR/spec.md`:

```markdown
# Spec: Adicionar regional_office ao cadastro de cliente

## Contexto
Time comercial precisa filtrar clientes por regional para campanhas direcionadas.
Refs: task Teamwork #2341.

## Objetivo
Customer DTO e tabela customers passam a aceitar regional_office (opcional).

## Escopo
### In scope
- Migration adicionando coluna regional_office
- DTO CustomerCreate / CustomerUpdate aceitam regional_office
- API GET /customers/{id} retorna regional_office
- API POST/PATCH /customers aceita regional_office

### Out of scope
- UI do cadastro (ticket separado)
- Validacao de "regional valida" (lista fechada de regionais)
- Backfill de dados existentes

## Criterios de aceite
1. Dado um cliente com regional_office='SP-Capital', quando GET /customers/{id}, entao payload contem "regional_office": "SP-Capital"
2. Dado POST /customers com regional_office='RJ-Sul', quando consulto DB, entao customers.regional_office='RJ-Sul'
3. Dado POST /customers SEM regional_office, quando consulto DB, entao customers.regional_office IS NULL
4. Dado migration rodada, quando rodo down migration, entao coluna nao existe mais

## Edge cases / Erros
- regional_office com string vazia "" -> deve aceitar (nao normaliza pra null)
- regional_office com >50 chars -> 400 Bad Request com mensagem clara
- regional_office com chars especiais -> aceita (sem sanitizacao)

## Dependencias / Pre-condicoes
- DB Postgres ja existente
- Alembic configurado

## Rollback
Migration down remove a coluna. Dados existentes sao perdidos (aceitavel — sem backfill).

## Nao-funcionais
- Performance: campo nao indexado, sem impacto em query existentes
- Seguranca: nao e PII, sem necessidade especial
```

### Step 3 — Judge SPECIFY (8s, $0.01)
```json
{
  "score": 0.85,
  "reasoning": "Spec cobre escopo, 4 criterios verificaveis com Dado/Quando/Entao, 3 edge cases listados. Rollback explicito. Pequeno gap: nao menciona o que acontece em UPDATE de cliente existente sem regional_office.",
  "category": "specify",
  "suggestions": ["Adicionar criterio sobre UPDATE preservando NULL"]
}
```
**APROVADO** (0.85 > 0.7).

### Step 4 — TASKS (50s, $0.03)
Modelo escreve `$ARTIFACTS_DIR/tasks.json`:

```json
[
  {
    "id": "T01",
    "description": "Alembic migration: adicionar coluna regional_office",
    "files": ["migrations/versions/004_add_regional_office.py"],
    "estimated_lines": 15,
    "complexity": "trivial",
    "dependencies": [],
    "acceptance_criteria": [
      "up() adiciona regional_office VARCHAR(50) NULL",
      "down() remove a coluna",
      "Migration roda em DB local sem erro"
    ],
    "status": "pending"
  },
  {
    "id": "T02",
    "description": "Adicionar campo no CustomerDTO (Pydantic)",
    "files": ["src/dto/customer.py"],
    "estimated_lines": 6,
    "complexity": "trivial",
    "dependencies": ["T01"],
    "acceptance_criteria": [
      "CustomerCreate.regional_office: Optional[str] = None",
      "CustomerUpdate.regional_office: Optional[str] = None",
      "Customer.regional_office: Optional[str] (response model)",
      "Validacao max_length=50",
      "test_customer_dto_includes_regional_office passa"
    ],
    "status": "pending"
  },
  {
    "id": "T03",
    "description": "Adicionar coluna no ORM model + persistir na API",
    "files": ["src/models/customer.py", "src/api/routes/customers.py"],
    "estimated_lines": 25,
    "complexity": "small",
    "dependencies": ["T01", "T02"],
    "acceptance_criteria": [
      "Model SQLAlchemy tem campo regional_office",
      "POST persiste regional_office no DB",
      "PATCH atualiza regional_office",
      "GET retorna regional_office no payload",
      "test_api_full_lifecycle passa"
    ],
    "status": "pending"
  }
]
```

### Step 5 — Judge TASKS (10s, $0.02)
```json
{"score": 0.9, "category": "tasks", "passed": true}
```

### Step 6 — Freeze artifacts (instant)
File integrity registra spec.md, tasks.json como FROZEN.

### Step 7 — EXECUTE loop iteration 1 (60s, $0.04)
Modelo le tasks.json, pega T01 (sem deps), implementa migration.
Roda alembic upgrade head -> OK. Marca T01 como completed.

### Step 8 — Gates T01 (20s, $0.001)
- ✅ Lint
- ✅ Tests (apenas migration test rodou)
- ✅ File Integrity (so mexeu em migrations/)
- ✅ Change Sufficiency (15 linhas em [1, 80])
- ✅ Embedding filter (0.78 similarity com spec)

### Step 9 — EXECUTE loop iteration 2 (40s, $0.03)
T02 implementado. CustomerDTO atualizado. test_customer_dto passa.

### Step 10 — Gates T02
Todos passam.

### Step 11 — EXECUTE loop iteration 3 (90s, $0.05)
T03 implementado. Model + API. Testes E2E.

### Step 12 — Gates T03
- ✅ Lint
- ✅ Tests (15/15 passing)
- ✅ File Integrity
- ✅ Change Sufficiency (25 linhas em [5, 80])
- ✅ Embedding filter (0.82)
- ✅ Judge final (0.88)

### Step 13 — EXECUTE iteration 4
Modelo le tasks.json, todas com status="completed". Responde:
```
ALL_TASKS_COMPLETE
```

### Step 14 — Human approval
Archon pausa, pergunta no terminal:
```
Spec: $ARTIFACTS_DIR/spec.md
Diff: git diff main (46 linhas adicionadas, 0 removidas, 4 arquivos)
Tests: 15/15 passing
Cost: R$ 0.27 / R$ 10.00 limit

Aprovar criacao de PR? [y/N]
```

Voce digita `y`.

### Step 15 — PR creation
```bash
gh pr create \
  --title "[#2341] feat: adicionar regional_office no cadastro de cliente" \
  --body "..."
```

PR criada: https://bitbucket.org/<your-workspace>/<repo>/pull/<id>

## Resumo final

- **Tempo total:** ~5 min
- **Custo:** R$ 0.27 (Claude API)
- **Lines of code geradas:** 46 (3 arquivos)
- **Lines of code de testes:** 28
- **Iteracoes do EXECUTE loop:** 4 (3 tasks + 1 confirmacao)
- **Gates falhados:** 0
- **Lessons capturadas:** 0
- **Audit trail:** events/abc123*.jsonl (87 eventos tipados)

## O que voce ganhou vs Claude Code solto

| | Claude Code solto | Com harness |
|---|---|---|
| Spec versionada | sem | spec.md commitado |
| Audit trail | sem | events/*.jsonl |
| Cost Cap | sem | R$ 0.27 / 10.00 monitorado |
| Tests obrigatorios | depende do prompt | enforced pelo gate |
| Convencao de branch/commit | depende | enforced pelo Judge |
| Repetibilidade | baixa | alta (mesma spec -> mesmo PR) |

## Variacoes

- **Para bug fix:** use `archon run fix-bug "..."` (pula SPECIFY/DESIGN, mantem gates)
- **Para PR review automatico:** `archon run pr-review 4521`
- **Para escapar do harness:** edite `harness/events/kill` (kill switch global)

## Reproducibilidade

Em 6 meses, com a mesma spec, voce ou um colega pode:

```bash
archon run sdd-task --spec=$ARTIFACTS_DIR/spec.md
```

E reproduzir o PR (ou variacao dele). Spec virou contrato.
