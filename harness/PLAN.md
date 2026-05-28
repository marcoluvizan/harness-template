# PLAN — Construcao do Harness em 3 Fases

> Plano explicito para adocao incremental do harness em projetos reais (internal projects).

## Filosofia

**Nao tente os 7 Pilares de uma vez.** Cada pilar so faz sentido sobre os anteriores. Construa em ordem de dependencia + ROI imediato.

```
Fase 1 (3 dias)   --> Fase 2 (1 semana)   --> Fase 3 (2-3 semanas)
[hooks ambientais]    [workflows SDD]         [judge + gates + lessons]
```

Cada fase deve **provar valor antes da seguinte**. Se Fase 1 nao reduz custos / aumenta confianca em 2 semanas de uso, **pare** — nao adianta empilhar complexidade.

---

## Fase 1 — Hooks Ambientais (3 dias)

> Sempre ativo, sem comando. Custo zero pra usuario.

### Entregaveis

1. **Cost Cap como hook** Claude Code
   - Hook `PreToolUse` lendo contador acumulado em `.archon/state/cost.json`
   - Aborta sessao se passa `cost_limit` em `config.yaml`
   - Mensagem clara: "limite atingido, encerrando sessao"
2. **File Integrity como hook**
   - Hook `PreToolUse` em `Write|Edit` checando lista de `frozen_paths`
   - Bloqueia + mensagem "arquivo congelado pela task atual"
3. **Audit log como hook**
   - Hook `PostToolUse` registrando tool call em `events/<run-id>.jsonl`
   - Schema: `{ts, tool, args_hash, result, cost_delta}`

### Pre-requisitos

- Claude Code instalado nos repos alvo
- `harness/.archon/scripts/` copiado pro projeto (ou symlink)
- `.claude/settings.json` apontando pros hooks

### Criterio de sucesso

- Cost Cap salva pelo menos 1 incidente real de run que ia queimar > R$ 20
- Audit log mostra cada decisao de IA na ultima semana
- Zero `frozen_paths` foram modificados acidentalmente

### Esforco

| Item | Tempo |
|---|---|
| cost_cap.ts + state persistente | 1 dia |
| file_integrity.ts + config loader | 1 dia |
| audit log + setup hooks no settings | 1 dia |
| **Total** | **3 dias** |

---

## Fase 2 — SDD Workflow no Archon (1 semana)

> Workflow chamado explicitamente. Forca SPECIFY -> DESIGN -> TASKS -> EXECUTE.

### Entregaveis

1. **`sdd-task.yaml`** — workflow Archon completo
2. **4 commands** prontos (specify, design, tasks, execute)
3. **Auto-sizing logic** — tarefa trivial (diff < 10 linhas estimado) pula SPECIFY/DESIGN
4. **Change Sufficiency** rodando como gate apos cada task

### Pre-requisitos

- Fase 1 completa (Cost Cap protege execucao)
- Archon instalado e funcionando localmente
- Pelo menos 1 repo com `.archon/` configurado

### Criterio de sucesso

- 5 tasks reais rodadas em workflow SDD, todas com PR final
- Spec versionada permite reproduzir a task em 1 mes
- Tempo medio do total (spec -> PR) <= 2x tempo manual

### Esforco

| Item | Tempo |
|---|---|
| sdd-task.yaml | 1 dia |
| commands (specify/design/tasks/execute) | 1 dia |
| auto-sizing logic | 1 dia |
| change_sufficiency.ts | 1 dia |
| 5 dry-runs em tasks reais | 1 dia |
| **Total** | **5 dias** |

---

## Fase 3 — Judge + Gates + Lessons (2-3 semanas)

> Sofisticacao: pre-judge barato, judge calibravel, regras que aprendem.

### Entregaveis

1. **judge.ts** — LLM-as-Judge com threshold + retry policy
2. **embedding_filter.ts** — pre-judge barato via Voyage/OpenAI embedding
3. **Gates cascade explicita** no workflow: lint -> tests -> integrity -> change_suf -> embedding -> judge
4. **stall_detector.ts** — detecta loop, mesma tool em sequencia, output igual
5. **Fallback chain** — light model -> strong model -> human, com triggers multi-source
6. **Cognition Lessons** — captura automatica em `lessons/` quando gate falha
7. **PR review workflow** — judge automatico em PR Bitbucket via webhook

### Pre-requisitos

- Fase 2 rodando em producao por pelo menos 2 semanas
- Voyage API key (ou OpenAI embedding) configurada **se quiser ligar embedding_filter**
  - Sem essa key, `embedding.enabled: false` no config — workflow funciona, so vai direto pro Judge LLM
- Acesso webhook Bitbucket pro repo principal
- Claude Pro Max autenticado no Claude Code (sem ANTHROPIC_API_KEY separada)

### Criterio de sucesso

- Judge intercepta pelo menos 1 PR ruim antes do merge por semana
- Embedding pre-judge filtra 30%+ dos casos triviais (economia de tokens)
- Lessons recorrentes (3+ ocorrencias) viram regra automatica
- Stall detector recupera pelo menos 1 run morto por semana

### Esforco

| Item | Tempo |
|---|---|
| judge.ts + threshold logic | 2 dias |
| embedding_filter.ts | 2 dias |
| gates cascade no workflow | 1 dia |
| stall_detector.ts + fallback chain | 3 dias |
| Cognition Lessons captura + promote | 2 dias |
| pr-review.yaml + webhook handler | 2 dias |
| 2 semanas de tuning real | 10 dias |
| **Total** | **22 dias** |

---

## O que NAO esta no plano

| Item | Por que nao |
|---|---|
| **microVM (Firecracker)** | Linux-only, hacky no Windows. ai-jail (subprocess) basta pro this context. |
| **Harness Bundles fingerprint** | So vale quando comparar 50+ variantes de config. Time pequeno nao chega la. |
| **Pilot layer separado** | Archon orchestrator + workflow YAML cobrem. Pilot extra e over-eng. |
| **Multi-agent crew avancada (CrewAI/etc)** | Workflow YAML resolve. Crew sera entregue pelos workshops SemanaIA. |
| **Frontend/UI** | CLI + Archon Web UI bastam. Sem React proprio. |

---

## Marcos de decisao (vai/nao-vai)

| Marco | Quando | Sinal de "vai" | Sinal de "nao vai" |
|---|---|---|---|
| Apos Fase 1 | 2 semanas de uso | Cost Cap salvou 1+ incidente real | Hooks ignorados, ninguem usou |
| Apos Fase 2 | 1 mes de uso | Spec versionada virou referencia | Devs escreveram spec ruim e ignoraram |
| Apos Fase 3 | 2 meses de uso | Judge intercepta 1+ PR/semana | Threshold mal calibrado, muito ruido |

**Regra:** so passa pra proxima fase se a anterior provou valor. Caso contrario, rollback parcial e melhora o que existe.

---

## Quem faz o que

> Sugestao de divisao se for 1 dev sozinho. Adapte conforme realidade.

### Solo dev (1 pessoa)
- Semana 1: Fase 1 completa
- Semana 2-3: Fase 2 (uma fase SDD por dia)
- Semana 4-6: Fase 3 (parcelado)

### Dupla
- Dev A: scripts (Cost Cap, Judge, gates)
- Dev B: workflows YAML + commands

---

## Conclusao

3 fases. **Fase 1 e 3 dias** e ja entrega 70% do valor da governanca. Comece por la.

Nunca pule a regra de **provar valor antes de adicionar complexidade**.
