# Harness Template

> **Spec-Driven AI coding with guardrails.** Drop-in pack for any project — wraps the [Archon](https://github.com/coleam00/Archon) workflow engine with the **7 Pillars of Harness Engineering** (Felipe Rodrigues, BHub.ai).

**Version:** v1.0 (May 2026)
**Validated on:** real Java/Spring Boot 3 + Vue 3 project (~R$ 2 / ~$0.40 per MEDIUM task)
**Supports:** Java/Maven, Node/Vue/React, Python, Go (gates are stack-aware)

---

## TL;DR — Why this exists

| Without harness | With harness |
|---|---|
| Claude/Cursor freeform | Pipeline SDD (Specify → Design → Tasks → Execute) |
| No automated review | LLM Judge after each phase + 6 gates before PR |
| Unpredictable cost | Cost cap per-run + per-day, configurable |
| Bugs in production | File integrity + Change sufficiency + Final judge |
| No learning loop | Cognition Lessons captured on every gate failure |
| No audit trail | Full event store in `.archon/logs/*.jsonl` |

**Observed cost:** ~R$ 2 (~$0.40 USD) per MEDIUM task. Default cap: R$ 10 / $2 per run.

---

## Quick start

```powershell
# 1. Clone this template once per machine
git clone https://github.com/<your-username>/harness-template.git C:\harness-template

# 2. In your project
cd D:\Projects\my-new-project
& C:\harness-template\install-harness.ps1 -Mode fresh

# 3. Validate
archon doctor

# 4. First task (start SMALL to learn the loop)
archon workflow run sdd-task --no-worktree "<describe the task>"
```

The installer copies `.archon/`, `harness/`, `.claude/settings.json`, updates `.gitignore`, sets env vars, runs `archon doctor`, and commits the initial drop-in.

---

## Prerequisites (once per machine)

| Tool | Install |
|---|---|
| [Claude Code CLI](https://docs.claude.com/claude-code) (authenticated) | follow docs |
| [Archon](https://github.com/coleam00/Archon) (workflow engine) | release binary or `bun install -g archon` |
| git | https://git-scm.com |
| PowerShell 5.1+ | bundled with Windows |
| WSL2 Ubuntu (recommended) | Archon spawns bash from WSL — `wsl --install` |

Bun + `minimatch` are bundled in `.archon/bin/` and `.archon/scripts/`.

**For automated PR creation:** configure your provider:
- **GitHub:** `gh auth login` (uses `gh pr create`)
- **Bitbucket:** save token in `~/.bitbucket_token` and export `BITBUCKET_EMAIL` + `BITBUCKET_WORKSPACE`

---

## The 7 Pillars (status from real validation)

| # | Pillar | Lives in | Status |
|---|---|---|---|
| 1 | **Spec-Driven Execution (SDD)** | `.archon/workflows/sdd-task.yaml` + `.archon/commands/*.md` | OK |
| 2 | **Coordination** (Pilot + Orchestrator) | Archon engine + workflow YAML | OK |
| 3 | **Verification & Judge** | `.archon/scripts/judge.ts` | OK |
| 4 | **Completion Gates cascade** | 6 gates: lint → tests → integrity → sufficiency → embedding → judge_final | OK |
| 5 | **Guardrails** (Cost Cap + File Integrity) | `cost_cap.ts` + `file_integrity.ts` | OK |
| 6 | **Resilience** (Stall + Fallback chain) | `stall_detector.ts` | not battle-tested |
| 7 | **Observability + Cognition Lessons** | `.archon/logs/*.jsonl` + `lessons/*.yaml` | OK |
| Bonus | Sandbox | subprocess + ai-jail (microVM out-of-scope) | OUT |

Deep dive in [`harness/docs/7-pillars.md`](harness/docs/7-pillars.md).

---

## Flow of one task (sdd-task)

```
identity_log       → captures HEAD SHA for later diffs
cost_cap_init      → initializes cost counter in .archon/state/cost.json
auto_size          → classifies SMALL/MEDIUM/LARGE
specify            → writes spec.md (frozen artifact)
judge_specify      → LLM-as-Judge: is the spec verifiable? score >= threshold?
design             → writes design.md
judge_design       → idem
tasks              → writes tasks.json (T01, T02, ...)
judge_tasks        → idem
freeze_artifacts   → marks spec/design/tasks immutable for execute_loop
execute_loop       → loop until ALL_TASKS_COMPLETE — 1 task per iteration
gate_lint          → mvnd validate / npm lint / ruff
gate_tests         → mvnd test / npm test / pytest
gate_file_integrity→ frozen artifacts haven't been touched
gate_change_sufficiency → diff fits within the envelope estimated by tasks
gate_embedding     → similarity spec vs diff (needs Voyage; default OFF)
gate_judge_final   → LLM judges the full diff vs the spec
human_approval     → PAUSE for dev approval
create_pr          → creates PR via gh (GitHub) or curl (Bitbucket API)
session_end_log    → finalizes event log
```

---

## Stack support

`gate_lint` and `gate_tests` auto-detect:

| Stack | Detection | Command |
|---|---|---|
| Java/Maven | `pom.xml` at root | `mvnd test -q` (fallback `mvn`) |
| Node/Vue/React | `package.json` with `test` script | `npm test` |
| Python | `pyproject.toml` + `pytest` on PATH | `pytest` |
| Gradle | `build.gradle` or `build.gradle.kts` | `./gradlew test` |

To add a new stack: edit `gate_tests` in `.archon/workflows/sdd-task.yaml`.

---

## Recommended production config (`.archon/config.yaml`)

Defaults are conservative. For production:

```yaml
cost:
  limit_brl: 5.00           # default: 10
  daily_limit_brl: 30.00    # default: 50
  warn_at_percent: 70

judge:
  threshold: 0.85           # default: 0.7
  policy_on_fail: "HALT"    # default: RETRY

file_integrity:
  frozen_paths:
    - "harness/**/*.md"
    - "$ARTIFACTS_DIR/spec.md"
    - "$ARTIFACTS_DIR/design.md"
    - "$ARTIFACTS_DIR/tasks.json"
    # Add your project's critical paths:
    - "src/main/resources/application.yml"
    - ".github/**"
    - "Dockerfile"
```

---

## Common commands

```powershell
archon doctor                                    # validate setup
archon workflow list                             # list available workflows
archon workflow run sdd-task --no-worktree "..." # run SDD task
archon workflow run fix-bug "..."                # quick bug fix (skips SPECIFY/DESIGN)
archon workflow status                           # active runs
archon workflow approve <run-id>                 # approve paused run
archon workflow reject <run-id>                  # reject paused run
archon workflow abandon <run-id>                 # cancel running run
```

---

## Upgrade

```powershell
# Update workflows/scripts while preserving your previous run state
cd D:\Projects\my-project
& C:\harness-template\install-harness.ps1 -Mode upgrade
```

Creates an automatic `.archon.bak-<timestamp>/` backup before overwriting.

---

## Troubleshooting

### `archon doctor` fails with "CLAUDE_BIN_PATH not set"

```powershell
[Environment]::SetEnvironmentVariable("CLAUDE_BIN_PATH", (Get-Command claude).Source, "User")
# Close and reopen the terminal
```

### Workflow hangs silently inside a Claude Code session

Archon detects `CLAUDECODE=1` and warns. Solution: run `archon workflow run ...` in a regular PowerShell terminal **outside** Claude Code, or:
```powershell
$env:ARCHON_SUPPRESS_NESTED_CLAUDE_WARNING = "1"
```

### `gate_judge_final` rejects with score=0

Likely a `git diff` issue. Check `events/<run-id>-start-sha.txt` — it should contain the initial HEAD SHA. If empty, there's a problem in `identity_log`. See `harness/PRODUCTION_READINESS.md` for the full gotcha catalog.

### Directories with corrupted names like `D[unicode chars]Prototipos...`

Bug from MSYS/WSL bash interpreting Windows paths as literals. The template's `.gitignore` already filters these. To clean manually:
```powershell
Get-ChildItem -Force -Directory | Where-Object Name -like "D[*]*" | Remove-Item -Recurse -Force
```

### `create_pr` fails

- **`gh: command not found`** — install GitHub CLI or configure Bitbucket credentials
- **Bitbucket auth failed** — Bitbucket Cloud requires App Password (not API token) for git push, and **username** (not email) as the user

9 more real-world gotchas documented in [`harness/PRODUCTION_READINESS.md`](harness/PRODUCTION_READINESS.md).

---

## What **NOT** to use yet (open gaps)

- Auto-merge without human approval — always goes through `human_approval`
- Repos with sensitive data without RBAC / centralized audit
- Tasks > 500 lines (LARGE) — not validated, cost grows quickly
- Multiple devs concurrent on the same repo without worktrees
- `stall_detector` and `fallback_chain` — functionally ready but not battle-tested

Full validation checklist in [`harness/PRODUCTION_READINESS.md`](harness/PRODUCTION_READINESS.md).

---

## Versioning

| Version | Date | Changes |
|---|---|---|
| **v1.0** | 2026-05-28 | Initial release. 9 workflow bugs fixed during real validation. `install-harness.ps1` validated. GitHub + Bitbucket support in `create_pr`. |
| v1.1 (planned) | — | `-Source <URL>` in installer. `embedding_filter` with Voyage. `stall_detector` validation. |
| v2.0 (planned) | — | Lessons auto-promote to team memory. CI webhook integration. Multi-dev stress test. |

Tags follow semver. Pin a version with `git clone --branch v1.0`.

---

## Contributing

Issues and PRs welcome. Commit convention:
- `harness/<area>: <description>` for template changes
- `[#<num>] <type>: <description>` for fixes linked to issues

---

## Credits

This template was originally developed and validated at **** (Brazil) by [@marcoluvizan](https://github.com/marcoluvizan), during the **Tech Leads Club** IA Avançado workshop (2nd edition, May 2026). Opened up for the broader community.

Built on top of:

- **Felipe Rodrigues** (BHub.ai) — *7 Pillars of Harness Engineering*
- **Waldemar Neto** (Tech Leads Club) — *5 Governance Foci* + Context Engineering
- **William Fernandes** (PayPal) — daily operation patterns
- **Anthropic** — *Effective Harnesses for Long-Running Agents*
- **Birgitta Bockeler** (Thoughtworks/Martin Fowler) — *Harness Engineering for Coding Agent Users*
- **ai-boost/awesome-harness-engineering** — base templates
- **coleam00/Archon** — the workflow engine this is built on

---

## License

MIT — do what you want, attribution appreciated.
