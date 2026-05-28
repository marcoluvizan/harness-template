# 7 Pilares do Harness Engineering

Mapeamento dos 7 Pilares apresentados por Felipe Rodrigues (BHub.ai) no workshop Tech Leads Club IA Avancado 2026 para esta implementacao concreta.

## Tese

> **Agente = Modelo + Harness**
>
> O modelo e o cerebro (commodity, trocavel). O harness e o corpo, os reflexos, a sala de cirurgia. Decide quando o cerebro recebe contexto, quem confere o output.

Comparar dois agentes nao e comparar modelos. E comparar harnesses.

---

## Pilar 01 — Spec-Driven Execution (SDD)

### Problema
Agente recebe "implementa SSO". Sem spec, decide na hora se e SAML ou OIDC, cookie ou JWT, se cobre logout. Cada execucao produz coisa diferente. O juiz que vai avaliar depois nao tem criterio.

### Padrao
```
SPECIFY -> DESIGN -> TASKS -> EXECUTE
```

- **Spec** e o gabarito do design
- **Design** e o gabarito das tarefas
- **Tasks** (com criterios de aceite) sao o gabarito da execucao

### Nossa implementacao

| Componente | Arquivo |
|---|---|
| Workflow | `.archon/workflows/sdd-task.yaml` |
| Prompt SPECIFY | `.archon/commands/specify.md` |
| Prompt DESIGN | `.archon/commands/design.md` |
| Prompt TASKS | `.archon/commands/tasks.md` |
| Prompt EXECUTE | `.archon/commands/execute.md` |
| Auto-sizing | logica no `sdd-task.yaml` (skip phases para diff trivial) |
| Artefatos produzidos | `$ARTIFACTS_DIR/{spec.md,design.md,tasks.json}` |

### Como difere do Spektor
Spektor tem "auto-sizing" embutido na engine; aqui implementamos como `when:` no YAML — funcionalmente equivalente, mas declarativo.

---

## Pilar 02 — Coordenacao (Pilot + Orchestrator)

### Problema
Agente recebe "migra autenticacao pra OIDC, atualiza dashboard, faz documentacao". Sem coordenacao, empilha tudo numa unica chamada, perde contexto no meio, esquece metade.

### Padrao
**Pilot** (maestro: decide qual fase vem agora) + **Orchestrator** (regua: pega cada task, prepara contexto, chama modelo, passa pelas gates).

### Nossa implementacao

| Camada | Onde |
|---|---|
| Pilot | Workflow YAML controla sequencia (depends_on, when:) |
| Orchestrator | Archon engine (`@archon/workflows`) executa cada node |

Diferenca: Spektor tem Pilot **separado** com state machine propria. Aqui o YAML faz isso declarativamente. Suficiente pra times pequenos; over-engineering pra times grandes.

---

## Pilar 03 — Verification & Judge

### Problema
"Testes verdes" nao e prova de "tarefa pronta". E prova de "nada do que estava testado quebrou". Agente "adiciona logout" deletando login antigo — testes passam.

### Padrao
**LLM-as-Judge**: segundo modelo, separado do executor, avalia output contra criterios de aceitacao.

**Anti-padrao critico**: mesmo modelo executando e julgando — ele se autoaprova.

### Nossa implementacao

| Componente | Arquivo |
|---|---|
| Judge script | `.archon/scripts/judge.ts` |
| Prompt do judge | `.archon/commands/judge.md` |
| Calibracao | `config.yaml` (judge_threshold, max_retries, policy) |

### Calibracao
```yaml
judge:
  threshold: 0.7              # score minimo para aprovar
  max_retries: 3              # quantas tentativas antes de halt
  policy_on_fail: RETRY       # RETRY | SKIP | HALT
  model: claude-sonnet-4-6    # diferente do executor (claude-opus-4-7)
```

### Pre-judge barato
Antes do judge LLM caro, roda `embedding_filter.ts`: compara spec vs output via embedding (Voyage/OpenAI). Score baixo = reprovado direto, sem pagar judge.

---

## Pilar 04 — Completion Gates em Cascata

### Problema
Agente celebra vitoria cedo. Recebe task 8 num estado quebrado. Cinco tasks depois, todo trabalho e inutil.

### Padrao (ordenado por custo, barato primeiro)

```
1. Validacao estrutural   (lint, typecheck)         - deterministico, gratis
2. Tests                  (unit/integration)        - deterministico, barato
3. File Integrity         (nao mexeu em frozen?)    - deterministico, gratis
4. Change Sufficiency     (diff size vs scope?)     - deterministico, gratis
5. Embedding Faithfulness (parece a spec?)          - barato (~$0.001/check)
6. Judge LLM              (cumpre a spec?)          - caro (~$0.05/check)
                 |
                 v
            TASK ACEITA
```

O que cai no lint nao chega no Judge — economiza tokens.

### Nossa implementacao

| Gate | Script | Custo aprox |
|---|---|---|
| Lint | `bash:` node no workflow chamando linter do projeto | $0 |
| Tests | `bash:` node | $0 |
| File Integrity | `.archon/scripts/file_integrity.ts` | $0 |
| Change Sufficiency | `.archon/scripts/change_sufficiency.ts` | $0 |
| Embedding | `.archon/scripts/embedding_filter.ts` | ~$0.001 |
| Judge | `.archon/scripts/judge.ts` | ~$0.05 |

### Falhas classificadas
Cada gate retorna `{passed: bool, category: 'lint'|'test'|'integrity'|..., suggestion: string}` — Pilar 7 (Cognition Lessons) consome essas categorias.

---

## Pilar 05 — Guardrails

### Problema
Sem limites, agente pode:
- Sobrescrever spec/teste que validava a propria task
- Fazer diff de 2 linhas para uma task de grande escopo
- Entrar em loop e queimar R$ 200 em 10 minutos

### Padrao
- **File Integrity** — arquivos congelados durante a task
- **Change Sufficiency** — diff size proporcional ao escopo
- **Cost Cap** — orcamento explicito por run

### Nossa implementacao

| Guardrail | Script | Configurado em |
|---|---|---|
| File Integrity | `file_integrity.ts` | `config.yaml: frozen_paths` |
| Change Sufficiency | `change_sufficiency.ts` | task definition (`min_lines`, `max_lines`) |
| Cost Cap | `cost_cap.ts` | `config.yaml: cost_limit_brl` |

### Detalhe do campo (Anthropic 2025)
Arquivos em **JSON sofrem menos sobrescrita acidental que arquivos em Markdown**. Por isso `tasks.json` (nao `tasks.md`) e o artefato canonico produzido pela fase TASKS.

---

## Pilar 06 — Resiliencia

### Problema
Modelos quebram, provedores quebram, tarefas travam silenciosamente. Sem detector, agente fica 15 minutos parado sem nem tentar fallback — queima reais em silencio.

### Padrao

**4 mecanismos:**
- **Stall detection** — mesma ferramenta em loop, output igual, stream parado
- **Fallback chain** — light -> strong -> human
- **Escalation policy** — cadeia esgota: para tudo OU pula-e-segue
- **Failure classification** — agente ou infra? Tratamento diferente

### Caso real (2026)
Agente popular tinha fallback chain que so disparava em erro de rate-limit. Stream travado (sem rate-limit) ficava 15 min parado. **Gatilho errado**.

> Licao: o gatilho da fallback chain importa tanto quanto a chain.

### Nossa implementacao

| Componente | Arquivo |
|---|---|
| Stall detector | `.archon/scripts/stall_detector.ts` |
| Fallback chain | Archon `fallback_model` no node config |
| Multi-trigger | stall_detector dispara `fallback_chain_trigger` event |
| Failure classification | `judge.ts` retorna `failure_type: agent | infra` |

---

## Pilar 07 — Observabilidade + Cognition Lessons

### Problema
Sem observabilidade seria, voce fica refem de "o agente disse que tentou X" — nao da pra provar, refutar, atribuir custo, rastrear decisao.

> **Voce nao tem produto, tem fe.**

### Padrao (2 camadas)

**Camada 1 — Event store**
Eventos tipados em event store auditavel. Exportavel pra Langfuse/OTel.

**Camada 2 — Cognition Lessons**
Erro vira regra, regra vira playbook. Log diz **o que falhou**. Playbook diz **o que repetir/evitar antes do proximo tiro**.

```yaml
lesson:
  trigger: "judge_failed"
  anti_pattern: "agent skipped tests and modified code"
  preferred_pattern: "run tests after each file edit"
  priority: high
  occurrences: 5
  promoted_to_team_memory: false
```

### Nossa implementacao

| Componente | Onde |
|---|---|
| Event store | `events/<run-id>.jsonl` (JSONL append-only) |
| Schema de eventos | `verification_started`, `judge_responded`, `gate_failed`, etc |
| Cognition Lessons | `lessons/*.yaml` (auto-gerados quando gate falha) |
| Promote to team memory | manual, depois de 3+ ocorrencias |
| Export Langfuse | TODO Fase 3 (otel exporter) |

### Harness Bundles
Cada execucao tem `bundle_id = hash(config + prompts + routing)`. Permite comparar perf entre versoes de config. **Nao implementado nesta versao** — over-eng pra time pequeno (Fase 3+).

---

## Bonus — Sandbox

### Problema
OWASP 2026 elevou **sandbox insuficiente a risco de seguranca**, nao mais so qualidade. Codigo gerado por LLM precisa rodar em sandbox real, nao em Docker compartilhado.

### Espectro (pior -> estado da arte)
| Nivel | Tecnologia |
|---|---|
| Nenhum | host nu |
| Docker | padrao (insuficiente) |
| Seccomp | syscalls filtradas |
| gVisor | kernel user-space |
| **microVMs** | **Firecracker (estado da arte)** |

### Nossa implementacao
- **Hoje:** subprocess + ai-jail (Akita, Rust, bubblewrap/sandbox-exec/Landlock) — clonado em `docs/cursos/.../repos/ai-jail/`
- **Futuro:** microVM Firecracker por execucao (Linux-only, complexo no Windows)

Decisao consciente: **subprocess basta pro contexto Sinapsis** (codigo nao adversarial). microVM e overhead nao justificado.

---

## Sumario: mapeamento Pilar -> Arquivo

| Pilar | Arquivos principais |
|---|---|
| 1. SDD | `workflows/sdd-task.yaml` + `commands/{specify,design,tasks,execute}.md` |
| 2. Pilot + Orchestrator | `workflows/*.yaml` (declarativo) + Archon engine |
| 3. Verification & Judge | `scripts/judge.ts` + `commands/judge.md` |
| 4. Completion Gates | `scripts/{file_integrity,change_sufficiency,embedding_filter,judge}.ts` |
| 5. Guardrails | `scripts/{cost_cap,file_integrity,change_sufficiency}.ts` + `config.yaml` |
| 6. Resiliencia | `scripts/stall_detector.ts` + Archon `fallback_model` |
| 7. Observabilidade | `events/*.jsonl` + `lessons/*.yaml` |
| Bonus. Sandbox | subprocess + ai-jail (manual) |

Ver `compatibility.md` para gap analysis detalhada vs Spektor.
