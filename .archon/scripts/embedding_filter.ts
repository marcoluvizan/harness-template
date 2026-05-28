/**
 * Embedding Filter - Pilar 4 (Pre-judge barato)
 *
 * Compara spec vs output via embeddings. Score baixo = reprovado direto,
 * sem chamar Judge LLM (que custa ~50x mais).
 *
 * Provider: Voyage (recomendado pra PT-BR) ou OpenAI
 *
 * Uso:
 *   bun run embedding_filter.ts --spec=spec.md --actual="diff content"
 *   bun run embedding_filter.ts --spec=spec.md --actual=output.md
 *
 * Exit codes:
 *   0  - Similaridade >= threshold (passa pro Judge)
 *   1  - Similaridade < threshold (reprovado)
 *   99 - Erro
 */

import { readFileSync, existsSync, mkdirSync, writeFileSync } from "fs";
import { parseArgs } from "util";

type EmbeddingConfig = {
  enabled: boolean;
  provider: "voyage" | "openai";
  model: string;
  threshold: number;
  api_key_env: string;
};

function loadConfig(): EmbeddingConfig {
  const candidates = [".archon/config.yaml", "harness/.archon/config.yaml"];
  for (const path of candidates) {
    if (existsSync(path)) {
      const text = readFileSync(path, "utf-8");
      const block = text.match(/embedding:\s*\n((?:\s+\S.*\n)*)/)?.[1] ?? "";
      // enabled: padrao false (so liga se voce tem VOYAGE_API_KEY ou OPENAI_API_KEY)
      const enabled = block.match(/enabled:\s*(true|false)/)?.[1] === "true";
      const provider = (block.match(/provider:\s*"?(\w+)/)?.[1] ?? "voyage") as EmbeddingConfig["provider"];
      const model = block.match(/model:\s*"?([^"\n]+)/)?.[1]?.trim() ?? "voyage-3";
      const threshold = parseFloat(block.match(/threshold:\s*([0-9.]+)/)?.[1] ?? "0.5");
      const apiKeyEnv = block.match(/api_key_env:\s*"?([^"\n]+)/)?.[1]?.trim() ?? "VOYAGE_API_KEY";
      return { enabled, provider, model, threshold, api_key_env: apiKeyEnv };
    }
  }
  return { enabled: false, provider: "voyage", model: "voyage-3", threshold: 0.5, api_key_env: "VOYAGE_API_KEY" };
}

// ============================================================================
// Providers
// ============================================================================

async function embedVoyage(texts: string[], model: string, apiKey: string): Promise<number[][]> {
  const response = await fetch("https://api.voyageai.com/v1/embeddings", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ input: texts, model }),
  });

  if (!response.ok) {
    throw new Error(`Voyage API error: ${response.status} ${await response.text()}`);
  }

  const data = await response.json() as { data: Array<{ embedding: number[] }> };
  return data.data.map(d => d.embedding);
}

async function embedOpenAI(texts: string[], model: string, apiKey: string): Promise<number[][]> {
  const response = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ input: texts, model }),
  });

  if (!response.ok) {
    throw new Error(`OpenAI API error: ${response.status} ${await response.text()}`);
  }

  const data = await response.json() as { data: Array<{ embedding: number[] }> };
  return data.data.map(d => d.embedding);
}

// ============================================================================
// Similaridade cosseno
// ============================================================================

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) throw new Error("vectors have different dims");
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
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

async function main(): Promise<void> {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      spec: { type: "string" },
      actual: { type: "string" },
      "run-id": { type: "string", default: process.env.WORKFLOW_ID ?? "default" },
    },
  });

  const specInput = values.spec!;
  const actualInput = values.actual!;
  const runId = values["run-id"]!;

  const spec = existsSync(specInput) ? readFileSync(specInput, "utf-8") : specInput;
  const actual = existsSync(actualInput) ? readFileSync(actualInput, "utf-8") : actualInput;

  const config = loadConfig();

  // Bypass se desabilitado (default: voce nao tem Voyage/OpenAI key)
  if (!config.enabled) {
    console.log(JSON.stringify({
      skipped: true,
      reason: "embedding.enabled=false em config.yaml",
      passed: true,
    }, null, 2));
    logEvent(runId, "gate_skipped", { gate: "embedding", reason: "disabled" });
    process.exit(0);
  }

  const apiKey = process.env[config.api_key_env];
  if (!apiKey) {
    console.error(`${config.api_key_env} nao definida. Configure ou deixe embedding.enabled=false no config.yaml`);
    process.exit(99);
  }

  // Truncate inputs (embedding APIs tem limite de tokens)
  const specTrunc = spec.substring(0, 8000);
  const actualTrunc = actual.substring(0, 8000);

  logEvent(runId, "embedding_check_started", { provider: config.provider, model: config.model });

  let embeddings: number[][];
  try {
    if (config.provider === "voyage") {
      embeddings = await embedVoyage([specTrunc, actualTrunc], config.model, apiKey);
    } else {
      embeddings = await embedOpenAI([specTrunc, actualTrunc], config.model, apiKey);
    }
  } catch (e) {
    console.error("Embedding error:", e);
    process.exit(99);
  }

  const similarity = cosineSimilarity(embeddings[0], embeddings[1]);

  logEvent(runId, "embedding_decision", {
    similarity,
    threshold: config.threshold,
    passed: similarity >= config.threshold,
  });

  const result = {
    similarity,
    threshold: config.threshold,
    passed: similarity >= config.threshold,
    provider: config.provider,
    model: config.model,
  };

  console.log(JSON.stringify(result, null, 2));

  if (similarity < config.threshold) {
    console.error(`EMBEDDING FILTER REPROVOU: similarity=${similarity.toFixed(3)} < threshold=${config.threshold}`);
    process.exit(1);
  }

  console.log(`EMBEDDING FILTER APROVOU: similarity=${similarity.toFixed(3)} >= threshold=${config.threshold}`);
  process.exit(0);
}

main().catch(e => {
  console.error("Embedding filter error:", e);
  process.exit(99);
});
