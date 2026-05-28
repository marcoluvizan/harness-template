# Governanca do Harness — 5 Focos do Waldemar Neto

Adaptacao dos 5 Focos apresentados na palestra "Governanca de IA: Quando Todo Mundo Pode Acessar Tudo" (Tech Leads Club IA Avancado 2026, Dia 2 - tarde).

## Os tres numeros que diagnosticam 2026

- **24%** das empresas tem visibilidade dos agentes de IA em uso
- **37** agentes em media rodando por organizacao, maioria sem auditoria
- **47%** sem controles especificos de seguranca para IA hoje

Fontes: Gravitee 2026, Kiteworks, BeyondScale.

## O que ja esta na sua empresa (sintomas)

1. Devs instalando MCPs sem revisao de seguranca
2. Agentes acessando data lake com credenciais herdadas
3. Skills e ferramentas conectadas a APIs internas sem auditoria
4. Prompts com dados sensiveis indo para LLMs publicos
5. Ninguem sabe qual agente fez o que, nem como parar

> Se 3 dos 5 acima sao verdade, **voce precisa dos 5 Focos imediatamente**.

---

## Foco 01 — Identidade para Agentes

> Pare de tratar agente como service account.

### Principios

Cada agente precisa de:
- **Identidade propria** (nao reusar credencial humana)
- **Dono humano** (alguem responsavel pela existencia do agente)
- **Lifecycle** (quando foi criado, quando deve morrer)
- **Kill switch** (como parar ele agora se algo der errado)

### Perguntas que cada agente responde

- Quem e o humano responsavel?
- Que escopo ele tem? Por quanto tempo? Com que dados?
- Como eu paro ele agora se algo der errado?

### Nossa implementacao

Cada workflow do Archon ja tem `run_id` unico. Adicionamos:

```yaml
# harness/.archon/workflows/sdd-task.yaml
metadata:
  owner: ${USER}              # quem disparou
  lifecycle: 24h              # auto-expira em 24h
  kill_switch_file: events/kill   # arquivo que mata tudo se existir
```

Cada execucao loga:
```json
{
  "event": "agent_session_started",
  "run_id": "uuid",
  "owner": "marco.luvizan@sinapsisenergia.com",
  "scope": ["bagre", "src/**/*.py"],
  "expires_at": "2026-05-27T10:00:00Z"
}
```

### Kill switch global

```bash
# Mata tudo, sem perguntar
touch d:/Prototipos/SemanaIA/harness/events/kill

# Workflow checa esse arquivo em todo node — sai imediato
```

---

## Foco 02 — AI/MCP Gateway

> Tudo passa por um ponto central.

### Por que importa

Sem isso voce nao ve nem controla. Vira **padrao de mercado em 2026**.

### Componentes do gateway

- **Autenticacao centralizada** (sem API keys soltas)
- **Logging imutavel** de prompts, respostas e tool calls
- **Policy enforcement**: redacao de PII, rate limits, allowlist

### Nossa implementacao (minima)

Em vez de gateway HTTP separado (overkill pra solo dev), usamos **interceptacao via Archon**:

- Todas chamadas LLM passam por Archon engine
- Archon tem `IAgentProvider` que pode logar tudo
- Hook `PostToolUse` no Claude Code captura prompt + response
- Tudo vai pra `events/<run-id>.jsonl`

Quando escalar:
- Self-hosted [MintMCP](https://mintmcp.com), [Truefoundry](https://truefoundry.com), [Cequence](https://cequence.com)
- Ou Cloudflare Worker como proxy simples

---

## Foco 03 — Enforcement em Runtime

> Decida no momento da chamada.

### Problema

Permissoes estaticas falham. O contexto da chamada importa: **quem, quando, com que dado, fazendo o que**.

### Padrao

```
TOOL CALL
   |
   v
INTERCEPTOR (avalia em runtime)
   |
   ├── identidade OK?       NAO -> bloquear
   ├── dado classificado?   NAO -> mascarar
   ├── escopo da acao OK?   NAO -> pedir aprovacao
   |
   v
EXECUTA (ou nao)
```

### Nossa implementacao

Hooks do Claude Code no `.claude/settings.json`:

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Edit|Write",
        "hooks": [{
          "type": "command",
          "command": "bun run harness/.archon/scripts/file_integrity.ts"
        }]
      },
      {
        "matcher": "Bash",
        "hooks": [{
          "type": "command",
          "command": "bun run harness/.archon/scripts/cost_cap.ts"
        }]
      }
    ]
  }
}
```

Cada tool call passa pelo interceptor antes de executar. Negativo -> bloqueia.

---

## Foco 04 — DLP Semantico

> Bloquear dominio nao basta.

### Problema

Bloquear `chatgpt.com` no firewall nao impede vazamento — agente local pode mandar PII pra LLM legitimo. **O risco e o conteudo, nao o canal.**

### Padrao

1. Classifique dados por sensibilidade (publico, interno, restrito, regulado)
2. Inspecione semanticamente cada prompt antes de enviar
3. Redaja PII / mascare / pause / negue

### Nossa implementacao (basica)

Em `harness/.archon/scripts/pii_redact.ts` (TODO Fase 3):

```typescript
// Lista de padroes de PII brasileiros
const PATTERNS = [
  /\b\d{3}\.\d{3}\.\d{3}-\d{2}\b/g,  // CPF
  /\b\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}\b/g,  // CNPJ
  /\b\d{1,2}\.\d{3}\.\d{3}-\d\b/g,  // RG
  // email, telefone, etc
];

function redact(text: string): string {
  let redacted = text;
  for (const pattern of PATTERNS) {
    redacted = redacted.replace(pattern, '[REDACTED]');
  }
  return redacted;
}
```

Hook `PreToolUse` em qualquer chamada LLM aplica redacao antes do envio.

### Contexto Sinapsis

Setor de energia tem dados regulados pela ANEEL:
- Dados de medicao (sensiveis)
- Dados de consumidor (LGPD)
- Tarifas comerciais (confidenciais)

DLP semantico nao e luxo — e exigencia regulatoria.

---

## Foco 05 — Governance vs Containment

> Ver nao basta, precisa parar.

### Conceito

- **Governance** = visibilidade, log, auditoria (passivo)
- **Containment** = capacidade de parar tudo em segundos (ativo)

Governance sem containment e "voce viu o agente quebrar a producao mas nao conseguiu parar a tempo".

### Padrao

**Kill switch que propaga em segundos**, testado antes do incidente.

### Nossa implementacao

```bash
# Kill switch local — arquivo monitorado por todos os workflows
touch harness/events/kill

# Workflow checa em cada node:
# bash:
#   command: "test ! -f harness/events/kill || exit 99"

# Globalmente Claude Code:
# hook PreToolUse retorna nao-zero se arquivo existe -> bloqueia tudo
```

### Teste do kill switch (importante)

> "Voce nao governa o que nao testa que para."

Mensalmente:
1. Inicia uma run longa
2. Cria `events/kill`
3. Mede: quanto tempo ate todos os agentes pararem?
4. Se > 10 segundos, ajusta polling do hook

### Build vs Buy

Espaco se profissionalizando:
- [MintMCP](https://mintmcp.com) — MCP Gateway
- [Truefoundry](https://truefoundry.com) — LLM Ops
- [Cequence](https://cequence.com) — API Security
- [Astrix](https://astrix.security) — Identity & Access

**Recomendacao Waldemar:** hibrido. Gateway pronto + policies in-house.

**Para Sinapsis:** comece in-house (este harness/) e avalie buy quando escalar pra 5+ devs.

---

## As 3 acoes para a proxima semana

Em ordem de prioridade (Waldemar dixit):

1. **Inventario** — listar todos os agentes/MCPs rodando agora. Sem isso voce nao governa o que nao ve.
2. **Gateway** — pelo menos UM ponto de log centralizado (mesmo que rudimentar)
3. **Kill switch** — capacidade de parar tudo testada e funcionando

> *"Voce nao governa o que nao ve."*

---

## Conexao com os 7 Pilares

| Foco Governanca | Pilar Tecnico relacionado |
|---|---|
| 1. Identidade | Pilar 5 (Guardrails) + Pilar 7 (Observabilidade) |
| 2. Gateway | Pilar 7 (Event store) + Pilar 2 (Orchestrator) |
| 3. Runtime enforcement | Pilar 5 (Guardrails — File Integrity, Cost Cap) |
| 4. DLP semantico | Pilar 5 (Guardrails — novo: PII redactor) |
| 5. Containment | Pilar 5 (Guardrails — Kill switch) + Pilar 7 |

**Pilares tecnicos** sao individuais (proteger UM agente). **Focos de governanca** sao organizacionais (gerenciar MUITOS agentes). Juntos formam o harness completo: individual + enterprise.
