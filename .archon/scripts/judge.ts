/**
 * Judge - Pilar 3 (Verification)
 *
 * LLM-as-Judge calibravel. Avalia output contra criterios de aceitacao.
 *
 * Uso:
 *   bun run judge.ts --phase=specify --input=spec.md --task="..."
 *   bun run judge.ts --phase=design --input=design.md --against=spec.md
 *   bun run judge.ts --phase=tasks --input=tasks.json --against=design.md
 *   bun run judge.ts --phase=final --input=<diff> --against=spec.md
 *   bun run judge.ts --phase=pr-review --input=validation.json --against=task.json
 *
 * Exit codes:
 *   0  - Aprovado (score >= threshold)
 *   1  - Reprovado (score < threshold) — workflow vai pra retry/skip/halt
 *   99 - Erro (config/API)
 *
 * Modelo do Judge DEVE ser diferente do executor (anti-padrao critico).
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { spawnSync } from "child_process";
import { parseArgs } from "util";

type JudgeConfig = {
  threshold: number;
  max_retries: number;
  policy_on_fail: "RETRY" | "SKIP" | "HALT";
  model: string;
};

type JudgeResult = {
  passed: boolean;
  score: number;
  reasoning: string;
  failure_type?: "agent" | "infra";
  suggestions: string[];
  category: string;
  cost_usd: number;  // Pilar 7: custo da chamada Claude
};

// ============================================================================
// Config
// ============================================================================

function loadJudgeConfig(): JudgeConfig {
  const candidates = [".archon/config.yaml", "harness/.archon/config.yaml"];
  for (const path of candidates) {
    if (existsSync(path)) {
      const text = readFileSync(path, "utf-8");
      // Parse subset do YAML
      const block = text.match(/judge:\s*\n((?:\s+\S.*\n)*)/)?.[1] ?? "";
      const threshold = parseFloat(block.match(/threshold:\s*([0-9.]+)/)?.[1] ?? "0.7");
      const maxRetries = parseInt(block.match(/max_retries:\s*(\d+)/)?.[1] ?? "3");
      const policy = (block.match(/policy_on_fail:\s*"?(\w+)/)?.[1] ?? "RETRY") as JudgeConfig["policy_on_fail"];
      const model = block.match(/model:\s*"?([^"\n]+)/)?.[1]?.trim() ?? "claude-sonnet-4-6";
      return { threshold, max_retries: maxRetries, policy_on_fail: policy, model };
    }
  }
  return { threshold: 0.7, max_retries: 3, policy_on_fail: "RETRY", model: "claude-sonnet-4-6" };
}

// ============================================================================
// Prompt templates por fase
// ============================================================================

function buildPrompt(phase: string, input: string, against: string, task: string): string {
  const base = `Voce e um Judge LLM. Sua funcao e avaliar se um output cumpre criterios de aceite.
NAO produza output novo. Apenas avalie.

Resposta OBRIGATORIA: JSON puro, sem markdown fences. Schema:
{
  "score": <number 0.0-1.0>,
  "reasoning": "<por que esse score>",
  "category": "<lint|test|integrity|change|embedding|judge|specify|design|tasks|final|pr-review>",
  "failure_type": "<agent|infra|null>",
  "suggestions": ["<acionavel>", "<acionavel>"]
}
`;

  switch (phase) {
    case "specify":
      return `${base}
TAREFA: ${task}

OUTPUT (spec.md):
${input}

Criterios de avaliacao da SPEC:
1. Define escopo (in / out of scope)
2. Lista criterios de aceite verificaveis
3. Identifica edge cases / casos de erro
4. Menciona dependencias / pre-condicoes
5. Tem secao de rollback / how-to-undo

Score = media ponderada (criterios 1, 2, 3 valem 30%, 4 e 5 valem 5%).`;

    case "design":
      return `${base}
SPEC (referencia):
${against}

OUTPUT (design.md):
${input}

Criterios de avaliacao do DESIGN:
1. Cobre TODOS os criterios de aceite da spec
2. Identifica arquivos / modulos afetados
3. Define schema de dados / API contracts
4. Menciona testes a serem escritos
5. Avalia trade-offs ou alternativas consideradas

Score = (1) vale 40%, demais 15% cada.`;

    case "tasks":
      return `${base}
DESIGN (referencia):
${against}

OUTPUT (tasks.json):
${input}

Criterios de avaliacao das TASKS:
1. Cobre 100% do design (rastreamento completo)
2. Tasks tem acceptance_criteria por task
3. Tasks tem estimated_lines compativel
4. Dependencias entre tasks declaradas
5. Cada task e independente / testavel isoladamente

Score = (1) vale 40%, demais 15% cada.`;

    case "final":
    case "fix-bug-final":
      return `${base}
SPEC (referencia):
${against}

DIFF IMPLEMENTADO:
${input.substring(0, 8000)}${input.length > 8000 ? "\n... (truncado)" : ""}

Criterios:
1. Diff cobre todos criterios de aceite da spec
2. Testes existem e passam
3. Codigo segue padroes do projeto
4. Sem regressao em codigo nao relacionado
5. Mudancas proporcionais ao escopo (nao under nem over)

Score = (1) e (2) valem 35% cada, demais 10% cada.`;

    case "pr-review":
      return `${base}
TASK NO TEAMWORK:
${against}

VALIDATION JSON:
${input}

Criterios:
1. Branch e commits seguem convencao Sinapsis
2. Numero da task no Teamwork bate com numero da branch
3. Escopo do PR == descricao da task
4. Testes presentes
5. Nenhum arquivo critico (.env, secrets) modificado

Score = todos pesam igual (20% cada).`;

    default:
      return `${base}
INPUT:
${input}

CONTEXTO:
${against}

Avalie qualidade geral. Score 0.0-1.0.`;
  }
}

// ============================================================================
// Chamada ao Claude via CLI subprocess (herda auth do Claude Pro Max)
// ============================================================================
//
// Em vez de chamar https://api.anthropic.com direto (precisa ANTHROPIC_API_KEY),
// usa o `claude` CLI ja autenticado via VSCode/Claude Pro Max.
// Custo conta na cota do Pro Max (5x multiplier) — sem cobranca API separada.

function resolveClaudeBin(): string {
  // Permite override via env var (recomendado em CI ou path nao-padrao)
  if (process.env.CLAUDE_BIN_PATH) return process.env.CLAUDE_BIN_PATH;
  // Fallback: assume `claude` no PATH (instalacao padrao do Claude Code)
  return "claude";
}

function mapModelToAlias(model: string): string {
  // Claude CLI aceita aliases curtos: 'opus', 'sonnet', 'haiku'
  // ou IDs completos. Mapeia os IDs do config para aliases quando possivel.
  if (model.includes("opus")) return "opus";
  if (model.includes("sonnet")) return "sonnet";
  if (model.includes("haiku")) return "haiku";
  return model; // ID literal
}

function callJudge(model: string, prompt: string): JudgeResult {
  const claudeBin = resolveClaudeBin();
  const cliModel = mapModelToAlias(model);

  // Prompt via stdin (evita problemas de quoting com prompts longos)
  const result = spawnSync(
    claudeBin,
    ["-p", "--output-format", "json", "--model", cliModel],
    {
      input: prompt,
      encoding: "utf-8",
      maxBuffer: 50 * 1024 * 1024, // 50MB - prompts + responses podem ser grandes
    }
  );

  if (result.status !== 0) {
    console.error(`Claude CLI failed (exit ${result.status}):`);
    console.error(result.stderr);
    process.exit(99);
  }

  // Parse do wrapper JSON do claude CLI
  // Formato: { "type": "result", "subtype": "success", "is_error": false,
  //            "result": "<texto da resposta>", "total_cost_usd": ..., ... }
  let wrapped: { result?: string; is_error?: boolean; total_cost_usd?: number };
  try {
    wrapped = JSON.parse(result.stdout);
  } catch (e) {
    console.error("Claude CLI retornou nao-JSON:", result.stdout.substring(0, 500));
    process.exit(99);
  }

  if (wrapped.is_error) {
    console.error("Claude CLI reportou erro:", wrapped.result);
    process.exit(99);
  }

  const text = wrapped.result ?? "";
  const costUsd = wrapped.total_cost_usd ?? 0;

  // Extrai JSON do output (Judge devolve JSON puro, mas pode ter fences)
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    console.error("Judge response sem JSON:", text.substring(0, 500));
    process.exit(99);
  }

  try {
    const parsed = JSON.parse(jsonMatch[0]) as {
      score: number;
      reasoning: string;
      category: string;
      failure_type?: "agent" | "infra" | null;
      suggestions: string[];
    };
    return {
      passed: parsed.score >= loadJudgeConfig().threshold,
      score: parsed.score,
      reasoning: parsed.reasoning,
      failure_type: parsed.failure_type ?? undefined,
      suggestions: parsed.suggestions ?? [],
      category: parsed.category ?? "judge",
      cost_usd: costUsd,
    };
  } catch (e) {
    console.error("Judge response parse error:", e);
    process.exit(99);
  }
}

// ============================================================================
// Pilar 5/7 - Reporta custo ao Cost Cap
// ============================================================================
//
// Conversao USD -> BRL: env var USD_TO_BRL ou default 5.0
// Spawn subprocess para evitar acoplamento entre scripts.

function reportCost(runId: string, costUsd: number, phase: string): void {
  if (costUsd <= 0) return;

  const usdToBrl = parseFloat(process.env.USD_TO_BRL ?? "5.0");
  const costBrl = costUsd * usdToBrl;

  const result = spawnSync(
    ".archon/bin/bun.exe",
    [
      "run",
      ".archon/scripts/cost_cap.ts",
      "check",
      "--run-id",
      runId,
      "--add-cost",
      costBrl.toFixed(4),
      "--reason",
      `judge_${phase}`,
    ],
    { encoding: "utf-8" }
  );

  // Cost Cap pode abortar (exit 2 = limit reached, exit 3 = daily limit)
  // Nesse caso propaga o sinal — judge nao continua se workflow foi morto
  if (result.status === 2 || result.status === 3) {
    console.error("COST CAP killed run, aborting judge");
    process.exit(result.status);
  }

  if (result.status !== 0) {
    console.error(`cost_cap check returned non-zero (${result.status}): ${result.stderr}`);
    // Nao aborta por erro do cost_cap — judge ja avaliou
  }
}

// ============================================================================
// Captura Cognition Lesson em caso de falha
// ============================================================================

function captureLesson(phase: string, result: JudgeResult, input: string): void {
  if (result.passed) return;

  mkdirSync("lessons", { recursive: true });
  const ts = Date.now();
  const lessonFile = `lessons/${phase}-${ts}.yaml`;

  const lesson = `# Cognition Lesson — auto-generated
trigger: "judge_failed_${phase}"
phase: "${phase}"
ts: "${new Date().toISOString()}"
score: ${result.score}
threshold: ${loadJudgeConfig().threshold}
category: "${result.category}"
failure_type: "${result.failure_type ?? "agent"}"
anti_pattern: |
  ${result.reasoning.split("\n").join("\n  ")}
preferred_pattern: |
${result.suggestions.map(s => `  - ${s}`).join("\n")}
priority: ${result.score < 0.3 ? "high" : result.score < 0.5 ? "medium" : "low"}
occurrences: 1
promoted_to_team_memory: false
input_excerpt: |
  ${input.substring(0, 500).split("\n").join("\n  ")}
`;

  writeFileSync(lessonFile, lesson);
  console.error(`Lesson captured: ${lessonFile}`);
}

// ============================================================================
// Event log
// ============================================================================

function logEvent(runId: string, event: string, data: Record<string, unknown>): void {
  mkdirSync("events", { recursive: true });
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    event,
    run_id: runId,
    ...data,
  });
  writeFileSync(`events/${runId}.jsonl`, line + "\n", { flag: "a" });
}

// ============================================================================
// Main
// ============================================================================

function main(): void {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      phase: { type: "string" },
      input: { type: "string" },
      against: { type: "string", default: "" },
      task: { type: "string", default: process.env.ARGUMENTS ?? "" },
      "run-id": { type: "string", default: process.env.WORKFLOW_ID ?? "default" },
    },
  });

  const phase = values.phase!;
  const inputPath = values.input!;
  const againstPath = values.against!;
  const task = values.task!;
  const runId = values["run-id"]!;

  // Carrega input (pode ser arquivo ou string)
  const input = existsSync(inputPath) ? readFileSync(inputPath, "utf-8") : inputPath;
  const against = againstPath && existsSync(againstPath) ? readFileSync(againstPath, "utf-8") : againstPath;

  const config = loadJudgeConfig();
  logEvent(runId, "judge_invoked", { phase, model: config.model });

  const prompt = buildPrompt(phase, input, against, task);
  const result = callJudge(config.model, prompt);

  logEvent(runId, "judge_decision", {
    phase,
    passed: result.passed,
    score: result.score,
    category: result.category,
    cost_usd: result.cost_usd,
  });

  // Reporta custo ao Cost Cap (Pilar 5)
  reportCost(runId, result.cost_usd, phase);

  console.log(JSON.stringify(result, null, 2));

  if (!result.passed) {
    captureLesson(phase, result, input);
    console.error(`JUDGE REPROVOU: score=${result.score} < threshold=${config.threshold}`);
    process.exit(1);
  }

  console.log(`JUDGE APROVOU: score=${result.score} >= threshold=${config.threshold}`);
  process.exit(0);
}

try {
  main();
} catch (e) {
  console.error("Judge error:", e);
  process.exit(99);
}
