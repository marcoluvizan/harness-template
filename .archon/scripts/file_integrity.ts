/**
 * File Integrity - Pilar 5 (Guardrails)
 *
 * Detecta tentativa de modificacao em arquivos congelados ("frozen").
 *
 * Modos:
 *   --check-mode=pre-edit  : hook PreToolUse, intercepta Write/Edit antes de executar
 *   --check-mode=git-diff  : check final via git diff (sem hook)
 *
 * Uso:
 *   bun run file_integrity.ts --check-mode=git-diff --frozen-list=path/to/frozen.txt
 *   bun run file_integrity.ts --check-mode=pre-edit --target=src/foo.py --frozen-list=...
 *
 * Como hook do Claude Code:
 *   "PreToolUse": [{
 *     "matcher": "Write|Edit|NotebookEdit",
 *     "hooks": [{"type":"command","command":"bun run harness/.archon/scripts/file_integrity.ts --check-mode=pre-edit"}]
 *   }]
 */

import { readFileSync, existsSync, mkdirSync, writeFileSync } from "fs";
import { execSync } from "child_process";
import { parseArgs } from "util";
import { minimatch } from "minimatch";

function loadFrozenPaths(frozenListPath: string): string[] {
  if (!existsSync(frozenListPath)) {
    // Tenta carregar do config.yaml
    const candidates = [".archon/config.yaml", "harness/.archon/config.yaml"];
    for (const path of candidates) {
      if (existsSync(path)) {
        const text = readFileSync(path, "utf-8");
        const block = text.match(/frozen_paths:\s*\n((?:\s+-\s+.*\n)*)/)?.[1] ?? "";
        const paths = block.split("\n")
          .map(l => l.match(/^\s+-\s+"?([^"\n]+)"?/)?.[1])
          .filter((p): p is string => Boolean(p))
          .map(p => p.trim());
        if (paths.length > 0) return paths;
      }
    }
    return [];
  }
  return readFileSync(frozenListPath, "utf-8")
    .split("\n")
    .map(l => l.trim())
    .filter(Boolean);
}

function matchesAny(file: string, patterns: string[]): boolean {
  for (const pattern of patterns) {
    // Resolve $ARTIFACTS_DIR e similares
    const resolved = pattern
      .replace("$ARTIFACTS_DIR", process.env.ARTIFACTS_DIR ?? ".archon/artifacts")
      .replace("$WORKFLOW_ID", process.env.WORKFLOW_ID ?? "default");
    if (minimatch(file, resolved) || file === resolved) {
      return true;
    }
  }
  return false;
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

// ============================================================================
// Mode: pre-edit (hook intercepta antes da edicao)
// ============================================================================

function preEditCheck(target: string, frozenPaths: string[], runId: string): void {
  if (matchesAny(target, frozenPaths)) {
    logEvent(runId, "tool_call_blocked", {
      reason: "file_integrity",
      file: target,
      matched_pattern: frozenPaths.find(p => matchesAny(target, [p])),
    });
    console.error(`FILE INTEGRITY: ${target} esta congelado pela task atual. Bloqueado.`);
    console.error(`Para desfreezar, edite ${process.env.ARTIFACTS_DIR}/_meta/frozen.txt`);
    process.exit(2);
  }
  // OK, passa o hook
  process.exit(0);
}

// ============================================================================
// Mode: git-diff (check final)
// ============================================================================

function gitDiffCheck(frozenPaths: string[], runId: string): void {
  let modifiedFiles: string[];
  try {
    const output = execSync("git diff --name-only HEAD", { encoding: "utf-8" });
    modifiedFiles = output.split("\n").filter(Boolean);
  } catch (e) {
    console.error("git diff falhou:", e);
    process.exit(99);
  }

  const violations = modifiedFiles.filter(f => matchesAny(f, frozenPaths));

  if (violations.length > 0) {
    logEvent(runId, "gate_failed", {
      gate: "file_integrity",
      violations,
    });
    console.error("FILE INTEGRITY GATE FAILED:");
    for (const v of violations) {
      console.error(`  - ${v} foi modificado mas estava frozen`);
    }
    process.exit(1);
  }

  logEvent(runId, "gate_passed", {
    gate: "file_integrity",
    files_checked: modifiedFiles.length,
  });
  console.log(`FILE INTEGRITY OK: ${modifiedFiles.length} arquivos modificados, 0 violacoes`);
  process.exit(0);
}

// ============================================================================
// Main
// ============================================================================

function main(): void {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      "check-mode": { type: "string", default: "pre-edit" },
      target: { type: "string", default: process.env.CLAUDE_TOOL_TARGET ?? "" },
      "frozen-list": { type: "string", default: "" },
      frozen: { type: "string", default: "" },
      "run-id": { type: "string", default: process.env.WORKFLOW_ID ?? "default" },
    },
  });

  const mode = values["check-mode"]!;
  const runId = values["run-id"]!;

  // frozenPaths pode vir de --frozen (csv inline) ou --frozen-list (file)
  let frozenPaths: string[] = [];
  if (values.frozen) {
    frozenPaths = values.frozen.split(",").map(s => s.trim()).filter(Boolean);
  } else if (values["frozen-list"]) {
    frozenPaths = loadFrozenPaths(values["frozen-list"]);
  } else {
    frozenPaths = loadFrozenPaths(""); // tenta config.yaml
  }

  if (frozenPaths.length === 0) {
    console.log("Nenhum arquivo congelado, skip");
    process.exit(0);
  }

  if (mode === "pre-edit") {
    if (!values.target) {
      console.error("--target obrigatorio em mode pre-edit");
      process.exit(99);
    }
    preEditCheck(values.target!, frozenPaths, runId);
  } else if (mode === "git-diff") {
    gitDiffCheck(frozenPaths, runId);
  } else {
    console.error(`Unknown mode: ${mode}. Use 'pre-edit' or 'git-diff'.`);
    process.exit(99);
  }
}

main();
