# Command: EXECUTE (fase 4 do SDD)

> Pilar 1 - Spec-Driven Execution

Voce esta na fase **EXECUTE**. Implementa UMA task por vez, valida com gates, marca completed, repete.

## Contexto disponivel

- Spec: `$ARTIFACTS_DIR/spec.md` (FROZEN)
- Design: `$ARTIFACTS_DIR/design.md` (FROZEN)
- Tasks: `$ARTIFACTS_DIR/tasks.json` (FROZEN — voce so atualiza `status`)

## Fluxo por iteracao

```
1. Le tasks.json
2. Encontra PROXIMA task com status="pending" cujas dependencias estao "completed"
3. Implementa essa task
4. Roda os criterios de aceite da task
5. Se todos passam: atualiza status="completed" + commit
6. Se algum falha: tenta corrigir, max 3 tentativas
7. Apos task completed (ou max retries), retorna controle
```

## Regras criticas

### 1. UMA task por iteracao

NUNCA implemente 2 tasks no mesmo ciclo. Mesmo que pareca facil. Cada gate roda apos cada task.

### 2. NUNCA edite arquivos FROZEN

`spec.md`, `design.md`, `tasks.json` (exceto campo `status`) estao **CONGELADOS**. Hook vai bloquear.

Se voce sente que a spec esta errada: PARE. Reporte como blocker. Nao tente "consertar".

### 3. Testes ANTES (TDD-light)

Para cada task com `acceptance_criteria` que envolve comportamento:

1. Escreva o teste que valida o criterio
2. Confirme que falha (red)
3. Implemente a logica
4. Confirme que passa (green)
5. Rode TODA a suite (sem regressao)

### 4. Mensagem de commit estruturada

Padrao Sinapsis:
```
[#<task_num>] <tipo>: <descricao>

Refs: spec.md#<secao>, tasks.json#<task_id>
```

Tipos: `feat`, `fix`, `refactor`, `chore`, `test`, `docs`.

### 5. Status update no tasks.json

Apos completar uma task, atualize SOMENTE o campo `status`:

```json
{
  "id": "T01",
  ...
  "status": "completed"   // era "pending"
}
```

Use `Edit` tool com `old_string: "\"status\": \"pending\""` para evitar substituicao acidental.

## Gates apos cada task

Apos voce marcar `status=completed`, o workflow Archon roda automaticamente:

1. **Lint** — `npm run lint` ou `ruff check`
2. **Tests** — `npm test` ou `pytest`
3. **File Integrity** — checa que voce nao mexeu em frozen
4. **Change Sufficiency** — diff size compativel com `estimated_lines`
5. **Embedding Filter** — output bate semanticamente com spec
6. **Judge LLM** — score >= threshold

Se algum gate falha:
- **Retry**: voce sera chamado de novo com `$LOOP_PREV_OUTPUT` contendo o erro
- **Skip**: task vira `skipped`, prossegue
- **Halt**: workflow para, requer intervencao humana

## Quando responder ALL_TASKS_COMPLETE

Se ao ler `tasks.json` voce ve que **TODAS** as tasks tem `status="completed"` (ou `skipped`):

Responda EXATAMENTE: `ALL_TASKS_COMPLETE`

Nada mais. Isso encerra o loop.

## Anti-padroes proibidos

- ❌ Pular testes "pra agilizar"
- ❌ "Melhorar" codigo adjacente nao relacionado
- ❌ Marcar `completed` sem rodar os criterios
- ❌ Editar spec/design/tasks pra fazer "fazer sentido"
- ❌ Implementar 2+ tasks no mesmo ciclo
- ❌ Refatorar arquivos pre-existentes sem necessidade da task

## Em caso de blocker

Se voce identificou que NAO consegue completar a task atual:

1. NAO marque como completed
2. Adicione campo `blocker_reason` na task no `tasks.json`
3. Responda explicando o blocker
4. Aguarde decisao humana

> Modelo brilhante em sala mal equipada nao opera. Confie no harness — gates existem por motivo.
