/**
 * Stall Detector - Pilar 6 (Resiliencia)
 *
 * Detecta agente travado:
 *   - Mesma ferramenta chamada N vezes seguidas com argumentos identicos
 *   - Output do agente sem mudar em N segundos (stream parado)
 *
 * Le events/<run-id>.jsonl e analisa padrao recente.
 *
 * Uso (poll mode, chamado periodicamente):
 *   bun run stall_detector.ts --run-id <uuid> --window-seconds 60
 *
 * Como hook PostToolUse para detectar loops:
 *   bun run stall_detector.ts --run-id <uuid> --mode=post-tool --tool=<name> --args-hash=<hash>
 *
 * Exit codes:
 *   0  - Sem stall
 *   1  - Stall detectado (dispara fallback)
 *   99 - Erro
 */

import { readFileSync, existsSync, mkdirSync, writeFileSync } from "fs";
import { parseArgs } from "util";

type Event = {
  ts: string;
  event: string;
  run_id?: string;
  [key: string]: unknown;
};

type StallConfig = {
  timeout_seconds: number;
  same_tool_loop_threshold: number;
  on_stall: "fallback" | "abort" | "continue";
};

function loadConfig(): StallConfig {
  const candidates = [".archon/config.yaml", "harness/.archon/config.yaml"];
  for (const path of candidates) {
    if (existsSync(path)) {
      const text = readFileSync(path, "utf-8");
      const block = text.match(/stall_detection:\s*\n((?:\s+\S.*\n)*)/)?.[1] ?? "";
      const timeout = parseInt(block.match(/timeout_seconds:\s*(\d+)/)?.[1] ?? "180", 10);
      const loopThreshold = parseInt(block.match(/same_tool_loop_threshold:\s*(\d+)/)?.[1] ?? "5", 10);
      const onStall = (block.match(/on_stall:\s*"?(\w+)/)?.[1] ?? "fallback") as StallConfig["on_stall"];
      return { timeout_seconds: timeout, same_tool_loop_threshold: loopThreshold, on_stall: onStall };
    }
  }
  return { timeout_seconds: 180, same_tool_loop_threshold: 5, on_stall: "fallback" };
}

function loadEvents(runId: string, lastN = 50): Event[] {
  const file = `events/${runId}.jsonl`;
  if (!existsSync(file)) return [];
  const lines = readFileSync(file, "utf-8").split("\n").filter(Boolean);
  const recent = lines.slice(-lastN);
  return recent.map(l => {
    try {
      return JSON.parse(l) as Event;
    } catch {
      return null;
    }
  }).filter((e): e is Event => Boolean(e));
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
// Detectores
// ============================================================================

function detectSameToolLoop(events: Event[], threshold: number): { detected: boolean; tool?: string; count: number } {
  // Pega os ultimos N eventos tool_call_started
  const toolCalls = events
    .filter(e => e.event === "tool_call_started")
    .slice(-threshold);

  if (toolCalls.length < threshold) {
    return { detected: false, count: toolCalls.length };
  }

  const firstTool = toolCalls[0].tool;
  const firstArgsHash = toolCalls[0].args_hash;
  const allSame = toolCalls.every(c => c.tool === firstTool && c.args_hash === firstArgsHash);

  return {
    detected: allSame,
    tool: firstTool as string | undefined,
    count: toolCalls.length,
  };
}

function detectTimeout(events: Event[], timeoutSeconds: number): { detected: boolean; seconds_silent: number } {
  if (events.length === 0) return { detected: false, seconds_silent: 0 };

  const lastEvent = events[events.length - 1];
  const lastTs = new Date(lastEvent.ts).getTime();
  const now = Date.now();
  const seconds_silent = Math.floor((now - lastTs) / 1000);

  return {
    detected: seconds_silent >= timeoutSeconds,
    seconds_silent,
  };
}

// ============================================================================
// Main
// ============================================================================

function main(): void {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      "run-id": { type: "string", default: process.env.WORKFLOW_ID ?? "default" },
      mode: { type: "string", default: "poll" },
      tool: { type: "string", default: "" },
      "args-hash": { type: "string", default: "" },
      "window-seconds": { type: "string", default: "" },
    },
  });

  const runId = values["run-id"]!;
  const config = loadConfig();
  const events = loadEvents(runId);

  // Modo post-tool: registra o evento e checa loop
  if (values.mode === "post-tool" && values.tool) {
    logEvent(runId, "tool_call_started", {
      tool: values.tool!,
      args_hash: values["args-hash"]!,
    });
  }

  // Detector 1: loop de mesma tool
  const loopResult = detectSameToolLoop(events, config.same_tool_loop_threshold);
  if (loopResult.detected) {
    logEvent(runId, "stall_detected", {
      type: "same_tool_loop",
      tool: loopResult.tool,
      count: loopResult.count,
      action: config.on_stall,
    });
    console.error(`STALL DETECTED (loop): ${loopResult.tool} called ${loopResult.count}x with same args`);

    if (config.on_stall === "fallback") {
      logEvent(runId, "fallback_triggered", { trigger: "same_tool_loop" });
      console.error("Triggering fallback chain");
      process.exit(1);
    } else if (config.on_stall === "abort") {
      process.exit(2);
    }
  }

  // Detector 2: timeout / stream parado
  const timeoutResult = detectTimeout(events, config.timeout_seconds);
  if (timeoutResult.detected) {
    logEvent(runId, "stall_detected", {
      type: "timeout",
      seconds_silent: timeoutResult.seconds_silent,
      threshold: config.timeout_seconds,
      action: config.on_stall,
    });
    console.error(`STALL DETECTED (timeout): no events for ${timeoutResult.seconds_silent}s (threshold ${config.timeout_seconds}s)`);

    if (config.on_stall === "fallback") {
      logEvent(runId, "fallback_triggered", { trigger: "timeout" });
      process.exit(1);
    } else if (config.on_stall === "abort") {
      process.exit(2);
    }
  }

  // Sem stall
  console.log(JSON.stringify({
    stall_detected: false,
    events_analyzed: events.length,
    seconds_since_last_event: timeoutResult.seconds_silent,
    same_tool_loop_count: loopResult.count,
  }, null, 2));

  process.exit(0);
}

main();
