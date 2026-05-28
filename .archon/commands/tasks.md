# Command: TASKS (fase 3 do SDD)

> Pilar 1 - Spec-Driven Execution

Voce esta na fase **TASKS**. Vai quebrar o design em tasks executaveis com criterios de aceite explicitos por task.

**Output OBRIGATORIO em JSON, nao Markdown** (Anthropic 2025: JSON sofre menos sobrescrita acidental que Markdown).

## Inputs

- Spec: `$ARTIFACTS_DIR/spec.md` (FROZEN)
- Design: `$ARTIFACTS_DIR/design.md` (FROZEN)
- Tarefa: `$ARGUMENTS`

## Output obrigatorio

Crie `$ARTIFACTS_DIR/tasks.json` com schema:

```json
[
  {
    "id": "T01",
    "description": "Adicionar coluna regional_office na tabela customers",
    "files": ["migrations/004_add_regional_office.py"],
    "estimated_lines": 12,
    "complexity": "trivial",
    "dependencies": [],
    "acceptance_criteria": [
      "Migration up cria coluna VARCHAR(50) nullable",
      "Migration down remove a coluna",
      "Migration roda em DB de teste sem erro",
      "Backfill de dados nao necessario (campo opcional)"
    ],
    "status": "pending"
  },
  {
    "id": "T02",
    "description": "Adicionar campo no CustomerDTO",
    "files": ["src/dto/customer.py"],
    "estimated_lines": 4,
    "complexity": "trivial",
    "dependencies": ["T01"],
    "acceptance_criteria": [
      "Campo regional_office: Optional[str] declarado",
      "DTO serializa/deserializa corretamente",
      "test_customer_dto_includes_regional_office passa"
    ],
    "status": "pending"
  },
  {
    "id": "T03",
    "description": "Expor campo na API GET /customers/{id}",
    "files": ["src/api/routes/customers.py"],
    "estimated_lines": 8,
    "complexity": "small",
    "dependencies": ["T02"],
    "acceptance_criteria": [
      "GET retorna regional_office no payload",
      "Campo eh null se DB nao tem valor",
      "test_api_returns_regional_office passa"
    ],
    "status": "pending"
  }
]
```

## Schema completo

```typescript
type Task = {
  id: string;                    // T01, T02, ...
  description: string;           // 1 linha clara
  files: string[];               // arquivos a serem criados/modificados
  estimated_lines: number;       // 1-N
  complexity: "trivial" | "small" | "medium" | "large";
  dependencies: string[];        // IDs de outras tasks que precisam vir antes
  acceptance_criteria: string[]; // checklist verificavel
  status: "pending";             // sempre pending na criacao
};
```

## Regras obrigatorias

1. **Toda task tem `acceptance_criteria`.** Sem isso, executor nao sabe quando parou.
2. **Toda task e independente OU declara deps explicitas.** Sem ordem implicita.
3. **Toda task aponta para `files` especificos.** Sem "varios lugares".
4. **Toda task tem `estimated_lines` realista.**
   - trivial: 1-10 linhas
   - small: 5-80 linhas
   - medium: 30-300 linhas
   - large: 100-1500 linhas
5. **Toda task e testavel isoladamente.** Se voce so consegue testar com outras junto, junta as tasks.
6. **Cobertura 100% do design.** Cada arquivo / contrato / teste no design vira pelo menos uma task.

## Anti-padroes a evitar

- ❌ Task com escopo aberto ("refatorar codigo legado")
- ❌ Task sem criterios de aceite
- ❌ Task que depende de "criterio do dev"
- ❌ Task gigante que deveria ter sido 3
- ❌ Acceptance criteria vagos ("deve funcionar bem")

## Apos escrever

Salve em `$ARTIFACTS_DIR/tasks.json` (JSON valido, parseable).

> As tasks sao o gabarito da execucao. Cada task deve ser tao clara que outro dev (ou outro agente) poderia executar sem perguntar nada.
