/**
 * Cost Cap - Pilar 5 (Guardrails)
 *
 * Monitora custo acumulado por run. Aborta se passar do limite.
 *
 * Uso:
 *   bun run cost_cap.ts init --run-id <uuid>
 *   bun run cost_cap.ts check --run-id <uuid> --add-cost <brl>
 *   bun run cost_cap.ts report --run-id <uuid>
 *
 * Como hook do Claude Code, em settings.json:
 *   "PreToolUse": [{
 *     "matcher": ".*",
 *     "hooks": [{"type": "command", "command": "bun run harness/.archon/scripts/cost_cap.ts check"}]
 *   }]
 *
 * Estado: .archon/state/cost.json (JSON, append por run)
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { dirname, join } from "path";
import { parseArgs } from "util";

type CostState = {
  runs: Record<string, RunCost>;
  daily: Record<string, number>; // YYYY-MM-DD -> total
};

type RunCost = {
  run_id: string;
  owner: string;
  started_at: string;
  ended_at?: string;
  cost_brl: number;
  limit_brl: number;
  status: "active" | "completed" | "killed_cost" | "killed_manual";
  events: CostEvent[];
};

type CostEvent = {
  ts: string;
  delta_brl: number;
  reason: string;
  cumulative_brl: number;
};

type Config = {
  cost: {
    limit_brl: number;
    daily_limit_brl: number;
    warn_at_percent: number;
    state_file: string;
  };
};

// ============================================================================
// Helpers
// ============================================================================

function loadConfig(): Config {
  // Procura config.yaml em ordem: cwd, harness/.archon, .archon
  const candidates = [
    ".archon/config.yaml",
    "harness/.archon/config.yaml",
    "../.archon/config.yaml",
  ];
  for (const path of candidates) {
    if (existsSync(path)) {
      // Parse YAML manualmente para evitar dep externa
      // (so precisa de cost.limit_brl etc)
      const text = readFileSync(path, "utf-8");
      const limit = parseFloat(text.match(/limit_brl:\s*([0-9.]+)/)?.[1] ?? "10");
      const daily = parseFloat(text.match(/daily_limit_brl:\s*([0-9.]+)/)?.[1] ?? "50");
      const warn = parseFloat(text.match(/warn_at_percent:\s*([0-9.]+)/)?.[1] ?? "80");
      const stateFile = text.match(/state_file:\s*"?([^"\n]+)/)?.[1] ?? ".archon/state/cost.json";
      return {
        cost: { limit_brl: limit, daily_limit_brl: daily, warn_at_percent: warn, state_file: stateFile },
      };
    }
  }
  // Defaults
  return {
    cost: {
      limit_brl: 10.0,
      daily_limit_brl: 50.0,
      warn_at_percent: 80,
      state_file: ".archon/state/cost.json",
    },
  };
}

function loadState(stateFile: string): CostState {
  if (!existsSync(stateFile)) {
    return { runs: {}, daily: {} };
  }
  return JSON.parse(readFileSync(stateFile, "utf-8"));
}

function saveState(stateFile: string, state: CostState): void {
  mkdirSync(dirname(stateFile), { recursive: true });
  writeFileSync(stateFile, JSON.stringify(state, null, 2));
}

function today(): string {
  return new Date().toISOString().split("T")[0];
}

function appendEvent(eventType: string, data: Record<string, unknown>): void {
  const ts = new Date().toISOString();
  const line = JSON.stringify({ ts, event: eventType, ...data });
  const runId = (data.run_id as string) ?? "unknown";
  const eventFile = `events/${runId}.jsonl`;
  mkdirSync("events", { recursive: true });
  writeFileSync(eventFile, line + "\n", { flag: "a" });
}

// ============================================================================
// Commands
// ============================================================================

function init(runId: string): void {
  const config = loadConfig();
  const state = loadState(config.cost.state_file);

  state.runs[runId] = {
    run_id: runId,
    owner: process.env.USER ?? process.env.USERNAME ?? "unknown",
    started_at: new Date().toISOString(),
    cost_brl: 0,
    limit_brl: config.cost.limit_brl,
    status: "active",
    events: [],
  };

  saveState(config.cost.state_file, state);
  appendEvent("cost_cap_initialized", {
    run_id: runId,
    limit_brl: config.cost.limit_brl,
  });

  console.log(`Cost Cap initialized for run ${runId}: limit R$ ${config.cost.limit_brl}`);
}

function check(runId: string, addCostBrl: number, reason: string): number {
  const config = loadConfig();
  const state = loadState(config.cost.state_file);
  const run = state.runs[runId];

  if (!run) {
    // Run nao inicializado — tolera (hook pode disparar antes de init)
    console.error(`Run ${runId} not initialized, skipping cost check`);
    return 0;
  }

  if (run.status !== "active") {
    console.error(`Run ${runId} already ${run.status}`);
    process.exit(1);
  }

  // Adiciona custo
  run.cost_brl += addCostBrl;
  run.events.push({
    ts: new Date().toISOString(),
    delta_brl: addCostBrl,
    reason,
    cumulative_brl: run.cost_brl,
  });

  // Check daily
  const day = today();
  state.daily[day] = (state.daily[day] ?? 0) + addCostBrl;

  // Warning
  const pctOfLimit = (run.cost_brl / run.limit_brl) * 100;
  if (pctOfLimit >= config.cost.warn_at_percent && pctOfLimit < 100) {
    appendEvent("cost_warning", {
      run_id: runId,
      cost_brl: run.cost_brl,
      limit_brl: run.limit_brl,
      pct: pctOfLimit,
    });
    console.error(`WARNING: Run ${runId} at ${pctOfLimit.toFixed(0)}% of limit (R$ ${run.cost_brl.toFixed(2)} / R$ ${run.limit_brl})`);
  }

  // Limit reached?
  if (run.cost_brl >= run.limit_brl) {
    run.status = "killed_cost";
    run.ended_at = new Date().toISOString();
    saveState(config.cost.state_file, state);
    appendEvent("cost_limit_reached", {
      run_id: runId,
      cost_brl: run.cost_brl,
      limit_brl: run.limit_brl,
    });
    console.error(`COST CAP REACHED: R$ ${run.cost_brl.toFixed(2)} / R$ ${run.limit_brl}. Aborting.`);
    process.exit(2);
  }

  // Daily limit?
  if (state.daily[day] >= config.cost.daily_limit_brl) {
    appendEvent("daily_limit_reached", {
      day,
      total_brl: state.daily[day],
      limit_brl: config.cost.daily_limit_brl,
    });
    console.error(`DAILY LIMIT REACHED: R$ ${state.daily[day].toFixed(2)} / R$ ${config.cost.daily_limit_brl}`);
    process.exit(3);
  }

  saveState(config.cost.state_file, state);
  return run.cost_brl;
}

function report(runId: string): void {
  const config = loadConfig();
  const state = loadState(config.cost.state_file);
  const run = state.runs[runId];

  if (!run) {
    console.error(`Run ${runId} not found`);
    process.exit(1);
  }

  const day = today();
  console.log(JSON.stringify({
    run: {
      run_id: run.run_id,
      owner: run.owner,
      started_at: run.started_at,
      ended_at: run.ended_at,
      status: run.status,
      cost_brl: run.cost_brl,
      limit_brl: run.limit_brl,
      pct_used: (run.cost_brl / run.limit_brl) * 100,
      events_count: run.events.length,
    },
    daily: {
      day,
      total_brl: state.daily[day] ?? 0,
      limit_brl: config.cost.daily_limit_brl,
    },
  }, null, 2));
}

// ============================================================================
// Entry point
// ============================================================================

function main(): void {
  const [, , command, ...rest] = process.argv;

  const { values } = parseArgs({
    args: rest,
    options: {
      "run-id": { type: "string", default: process.env.WORKFLOW_ID ?? "default" },
      "add-cost": { type: "string", default: "0" },
      reason: { type: "string", default: "tool_call" },
    },
    allowPositionals: true,
  });

  const runId = values["run-id"]!;
  const addCost = parseFloat(values["add-cost"]!);
  const reason = values.reason!;

  switch (command) {
    case "init":
      init(runId);
      break;
    case "check":
      check(runId, addCost, reason);
      break;
    case "report":
      report(runId);
      break;
    default:
      console.error(`Usage:
  cost_cap.ts init --run-id <uuid>
  cost_cap.ts check --run-id <uuid> --add-cost <brl> --reason <text>
  cost_cap.ts report --run-id <uuid>`);
      process.exit(1);
  }
}

main();
