# Matriz de Compatibilidade vs Spektor

Esta implementacao **nao e Spektor** — Spektor e produto fechado do Felipe Rodrigues (BHub.ai), ainda em construcao em 2026.

Esta tabela documenta onde **funcionalmente equivalemos** o que foi apresentado publicamente vs onde divergimos conscientemente.

## Matriz completa

| Pilar / Componente | Spektor (publico) | Nossa Impl | Status |
|---|---|---|---|
| **1. SDD - 4 fases obrigatorias** | Core, engine forca | YAML declarativo do Archon | OK |
| **1. SDD - Auto-sizing** | Engine decide pular fases | `when:` condicoes no YAML | OK |
| **1. SDD - Spec como contrato** | Versionada na engine | Salva em `$ARTIFACTS_DIR/spec.md` | OK |
| **2. Pilot layer separado** | Sim, state machine propria | Workflow YAML cobre | DIVERGENTE (consciente) |
| **2. Orchestrator** | Custom | Archon engine | OK |
| **2. Multi-modelo no mesmo run** | Sim | Sim (Archon `provider:` por node) | OK |
| **3. Judge calibravel (threshold)** | Sim | `config.yaml: judge.threshold` | OK |
| **3. Judge com retry policy** | Sim (RETRY/SKIP/HALT) | `config.yaml: judge.policy_on_fail` | OK |
| **3. Embedding pre-judge** | Sim | `embedding_filter.ts` (Voyage/OpenAI) | OK |
| **4. Lint gate** | Sim | `bash:` node | OK |
| **4. Tests gate** | Sim | `bash:` node | OK |
| **4. File Integrity gate** | Sim | `file_integrity.ts` | OK |
| **4. Change Sufficiency gate** | Sim | `change_sufficiency.ts` | OK |
| **4. Embedding gate** | Sim | `embedding_filter.ts` | OK |
| **4. Judge LLM gate** | Sim | `judge.ts` | OK |
| **5. File Integrity (frozen)** | Sim | `file_integrity.ts` | OK |
| **5. Change Sufficiency (diff size)** | Sim | `change_sufficiency.ts` | OK |
| **5. Cost Cap por run** | Sim | `cost_cap.ts` | OK |
| **6. Stall detection** | Sim | `stall_detector.ts` | OK |
| **6. Fallback chain (light->strong->human)** | Sim | Archon `fallback_model` | OK |
| **6. Multi-trigger fallback** | Sim (stall, timeout, rate-limit) | `stall_detector.ts` dispara via event | OK |
| **6. Failure classification (agent vs infra)** | Sim | `judge.ts` retorna `failure_type` | OK |
| **7. Event store auditavel** | Sim | `events/*.jsonl` JSONL append-only | OK |
| **7. Eventos tipados** | Sim (com OTel) | JSONL com schema fixo | PARCIAL (sem OTel) |
| **7. Harness Bundles fingerprint** | Sim | NAO IMPLEMENTADO | OUT (Fase 3+) |
| **7. Cognition Lessons captura** | Sim | `lessons/*.yaml` auto-gerado | OK |
| **7. Cognition Lessons promote** | Sim (memoria de time) | Manual (sem promote automatico ainda) | PARCIAL |
| **7. Export Langfuse/OTel** | Sim | TODO Fase 3 | OUT |
| **Bonus. Subprocess sandbox** | Sim | Archon nativo + ai-jail | OK |
| **Bonus. microVM (Firecracker)** | Roadmap Spektor | NAO IMPLEMENTADO | OUT |

## Onde sao funcionalmente equivalentes

**~85% do que foi apresentado publicamente.**

Tudo que conta como guardrail diario (Cost Cap, File Integrity, Judge, Gates, Stall) esta funcional. A diferenca pratica para um dev usando dia-a-dia e marginal.

## Onde DIVERGIMOS conscientemente

### 1. Pilot layer separado
Spektor tem Pilot como state machine em codigo. Aqui o workflow YAML faz isso declarativamente.

**Por que:** YAML e mais auditavel, versionavel, mais simples de explicar. Pilot codado e necessario quando state e complexo demais pra YAML — nao e o nosso caso ainda.

**Quando reconsiderar:** se a equipe rodar 10+ workflows complexos com state cross-run, vale extrair pra modulo TS dedicado.

### 2. Harness Bundles fingerprint
Spektor fingerprinta cada execucao com hash de config+prompts+routing pra comparar perf entre variantes.

**Por que nao temos:** so faz sentido quando voce compara 50+ variantes de config em prod. Time pequeno nao chega la.

**Quando reconsiderar:** quando voce tiver 3+ workflows em prod com tuning ativo.

### 3. microVM sandbox (Firecracker)
Spektor planeja microVM por execucao.

**Por que nao temos:** Linux-only, complexo no Windows, **codigo gerado para your projects nao e adversarial** — subprocess + ai-jail cobre.

**Quando reconsiderar:** quando rodar codigo de terceiros desconhecidos (marketplace de skills, etc).

### 4. Export OTel/Langfuse
Spektor exporta nativo.

**Por que nao temos:** time pequeno usa logs JSONL direto. Otel agrega valor com 5+ servicos pra correlacionar.

**Quando reconsiderar:** quando passar de 3 servicos em prod usando harness.

## Onde superamos publicamente

Esta implementacao tem coisas que Felipe nao detalhou publicamente:

| Componente | Nossa vantagem | Justificativa |
|---|---|---|
| **Kill switch global por arquivo** | Foco 5 do Waldemar implementado literal | Setor regulado precisa |
| **PII redactor (TODO Fase 3)** | Padroes BR (CPF/CNPJ/RG) | team-specific |
| **Templates copiados literais** | `awesome-harness/templates/*` | Padrao da industria, nao reinvenamos |
| **3 fases de adocao** | Plan progressivo, prova valor antes de avancar | Realismo de time pequeno |

## Compatibilidade vs Archon

100% — esta implementacao **e** Archon-compatible:
- Workflows YAML usando schema do Archon
- Scripts em TypeScript (bun) como Archon prefere
- `.archon/` layout padrao
- `$ARTIFACTS_DIR`, `$DOCS_DIR`, `$WORKFLOW_ID` substituidos pelo Archon

Voce **pode** rodar tudo no Archon nativo sem mexer em nada.

## Trade-offs aceitos

- **Sem UI proprio** — usamos a Web UI do Archon
- **Sem Slack/Discord adapter** — Archon ja tem
- **Sem multi-tenant** — single-developer pattern (igual Archon)
- **Sem agentes paralelos auto-coordenados** — workflow YAML e sequencial-com-paralelizacao-de-irmaos

## Conclusao

Esta implementacao cobre **a essencia funcional do que Felipe apresentou** com **2-3 semanas de eng** vs Spektor que tem um time + meses de desenvolvimento.

Nao e produto. E **scaffold + padrao** copiavel pra qualquer your project.

Se Spektor lancar publico e valer mais que esse setup, migracao e simples — mesmos conceitos.
