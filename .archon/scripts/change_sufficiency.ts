/**
 * Change Sufficiency - Pilar 5 (Guardrails)
 *
 * Valida que o diff esta proporcional ao escopo declarado.
 *
 * Pintor mostra dois cantos e cobra a casa inteira? Sinal vermelho.
 * Task grande com diff de 2 linhas: provavelmente nao implementou.
 * Task pequena com diff de 500 linhas: provavelmente fez muito mais do que pediu.
 *
 * Uso:
 *   bun run change_sufficiency.ts --tasks=tasks.json --base-branch=main
 *   bun run change_sufficiency.ts --mode=fix-bug --expected-lines=1-30 --base-branch=main
 *
 * Exit codes:
 *   0  - Diff dentro da faixa esperada
 *   1  - Diff fora da faixa (policy=block)
 *   0  - Warning emitido (policy=warn) — exit 0 para nao quebrar workflow
 *   99 - Erro
 */

import { readFileSync, existsSync, mkdirSync, writeFileSync } from "fs";
import { execSync } from "child_process";
import { parseArgs } from "util";

type Task = {
  id: string;
  description: string;
  estimated_lines: number;
  status?: string;
};

type Range = { min: number; max: number };

const DEFAULT_RANGES: Record<string, Range> = {
  trivial: { min: 1, max: 10 },
  small: { min: 5, max: 80 },
  medium: { min: 30, max: 300 },
  large: { min: 100, max: 1500 },
};

function loadPolicy(): "warn" | "block" {
  const candidates = [".archon/config.yaml", "harness/.archon/config.yaml"];
  for (const path of candidates) {
    if (existsSync(path)) {
      const text = readFileSync(path, "utf-8");
      const match = text.match(/out_of_range_policy:\s*"?(\w+)/);
      if (match) return match[1] as "warn" | "block";
    }
  }
  return "warn";
}

function rangeFromEstimate(estimatedLines: number): Range {
  if (estimatedLines <= 10) return DEFAULT_RANGES.trivial;
  if (estimatedLines <= 80) return DEFAULT_RANGES.small;
  if (estimatedLines <= 300) return DEFAULT_RANGES.medium;
  return DEFAULT_RANGES.large;
}

function getDiffStats(baseBranch: string): { added: number; deleted: number; files: number } {
  try {
    const numstat = execSync(`git diff --numstat ${baseBranch}`, { encoding: "utf-8" });
    let added = 0;
    let deleted = 0;
    let files = 0;
    for (const line of numstat.split("\n").filter(Boolean)) {
      const [a, d] = line.split("\t");
      if (a && d && a !== "-" && d !== "-") {
        added += parseInt(a, 10);
        deleted += parseInt(d, 10);
        files++;
      }
    }
    return { added, deleted, files };
  } catch (e) {
    console.error("git diff numstat falhou:", e);
    process.exit(99);
  }
}

function parseExpectedRange(spec: string): Range {
  // "1-30" -> {min:1, max:30}
  // "small" -> DEFAULT_RANGES.small
  if (DEFAULT_RANGES[spec]) return DEFAULT_RANGES[spec];
  const match = spec.match(/(\d+)\s*-\s*(\d+)/);
  if (match) return { min: parseInt(match[1], 10), max: parseInt(match[2], 10) };
  throw new Error(`expected-lines invalido: ${spec}`);
}

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

function main(): void {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      tasks: { type: "string", default: "" },
      mode: { type: "string", default: "tasks" },
      "expected-lines": { type: "string", default: "" },
      "base-branch": { type: "string", default: "main" },
      "run-id": { type: "string", default: process.env.WORKFLOW_ID ?? "default" },
    },
  });

  const runId = values["run-id"]!;
  const baseBranch = values["base-branch"]!;
  const stats = getDiffStats(baseBranch);
  const totalChanged = stats.added + stats.deleted;

  // Determina range esperado
  let range: Range;
  let source: string;

  if (values.mode === "fix-bug" && values["expected-lines"]) {
    range = parseExpectedRange(values["expected-lines"]!);
    source = `mode=fix-bug expected-lines=${values["expected-lines"]}`;
  } else if (values.tasks && existsSync(values.tasks!)) {
    const tasks = JSON.parse(readFileSync(values.tasks!, "utf-8")) as Task[];
    const totalEstimated = tasks.reduce((s, t) => s + (t.estimated_lines ?? 0), 0);
    range = rangeFromEstimate(totalEstimated);
    source = `tasks.json (${tasks.length} tasks, estimated ${totalEstimated} lines)`;
  } else {
    // Sem referencia, skip
    console.log("Sem referencia para validar (tasks.json ou --expected-lines), skipping");
    process.exit(0);
  }

  const ok = totalChanged >= range.min && totalChanged <= range.max;
  const policy = loadPolicy();

  const result = {
    changed_lines: totalChanged,
    added: stats.added,
    deleted: stats.deleted,
    files: stats.files,
    expected_range: range,
    source,
    passed: ok,
    policy,
  };

  console.log(JSON.stringify(result, null, 2));

  if (!ok) {
    logEvent(runId, "gate_failed", {
      gate: "change_sufficiency",
      ...result,
    });
    const verb = totalChanged < range.min ? "TOO_FEW" : "TOO_MANY";
    console.error(`CHANGE SUFFICIENCY ${verb}: ${totalChanged} lines, expected ${range.min}-${range.max}`);

    if (policy === "block") {
      process.exit(1);
    } else {
      console.warn("Policy=warn, continuando com aviso");
    }
  } else {
    logEvent(runId, "gate_passed", {
      gate: "change_sufficiency",
      ...result,
    });
    console.log(`CHANGE SUFFICIENCY OK: ${totalChanged} lines in [${range.min}, ${range.max}]`);
  }

  process.exit(0);
}

main();
