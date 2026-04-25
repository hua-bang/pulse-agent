---
name: project-roadmap
description: Analyze the current Pulse Coder project/repository and turn vague or concrete needs into prioritized requirements, milestones, tasks, validation plans, and execution handoff. Use when user asks “分析当前项目”, “后续需求推进”, “项目规划”, “下一步做什么”, “roadmap”, “需求拆解”, “排期”, or wants a project health check plus delivery plan.
version: 1.0.0
author: Pulse Coder Team
---

# Project Roadmap Skill — 项目分析与需求推进

## Goal

Use this skill to analyze the current project/repository and convert product or engineering needs into an actionable delivery plan.

The expected outcome is **not just a summary**. It must produce:
1. Current-state project map.
2. Evidence-backed diagnosis.
3. Requirement clarification and decomposition.
4. Prioritized roadmap.
5. Milestone/task plan with validation gates.
6. Clear next action for the agent or human team.

---

## Trigger Examples

Use this skill when the user says things like:
- “帮我分析当前项目，并安排后续需求推进”
- “看一下这个项目现在该做什么”
- “给这个需求做拆解和排期”
- “帮我规划下一阶段 roadmap”
- “项目体检一下，列出优先级”
- “analyze this repo and propose next milestones”

---

## Non-Negotiable Rules

1. **Evidence first.**  
   Project claims must come from files, commands, docs, tests, git history, or explicit user input. If not verified, mark as `Assumption`.

2. **Protect user work.**  
   Always inspect `git status --short` before proposing or making code changes. Never overwrite uncommitted user changes unless explicitly instructed.

3. **Separate planning from implementation.**  
   - Analysis and planning may proceed directly.
   - Code changes, deletions, migrations, production operations, and dependency updates require explicit scope clarity. If the user only asked for planning, do not implement.

4. **Ask only high-leverage questions.**  
   If critical information is missing, ask at most 3 focused questions. Otherwise proceed with stated assumptions.

5. **Make requirements testable.**  
   Every proposed requirement must include acceptance criteria or a measurable success signal.

6. **Prefer small safe increments.**  
   Break work into reviewable PR-sized slices. Avoid giant “rewrite everything” plans unless the repo evidence makes it unavoidable.

7. **Keep one active execution thread.**  
   For multi-step work, use task tracking: list/create/update tasks, keep one main task `in_progress`, mark blockers clearly.

---

## Current Project Profile: Pulse Coder

When operating in this repository, treat the project as a TypeScript `pnpm` monorepo.

### Key Workspaces

| Path | Role |
|---|---|
| `packages/engine` | Core agent engine: loop, tools, context, plugins, built-in skill/task/tool-search systems. |
| `packages/cli` | Interactive terminal CLI built on `pulse-coder-engine`. |
| `packages/pulse-sandbox` | Sandboxed JavaScript runtime and `run_js` tool adapter. |
| `packages/memory-plugin` | Memory integration/service package. |
| `packages/plugin-kit` | Runtime plugin toolkit, including worktree/vault/devtools helpers. |
| `packages/acp` | ACP client/runner integration. |
| `packages/orchestrator` | Multi-agent orchestration layer. |
| `packages/agent-teams` | Multi-session collaborative agent coordination. |
| `packages/canvas-cli` | Pulse Canvas CLI and bundled canvas skills. |
| `packages/langfuse-plugin` | Observability plugin. |
| `apps/remote-server` | HTTP/webhook runtime for Feishu/Discord and internal agent API. |
| `apps/teams-cli` | CLI for agent teams. |
| `apps/canvas-workspace` | Electron canvas workbench. |

### Important Runtime Notes

- Source lives in each workspace’s `src/`; build output goes to `dist/`.
- Root commands:
  - `pnpm run build`
  - `pnpm test`
  - `pnpm run dev`
  - `pnpm start`
- Useful targeted checks:
  - `pnpm --filter pulse-coder-engine typecheck`
  - `pnpm --filter pulse-coder-engine test`
  - `pnpm --filter pulse-coder-cli test`
  - `pnpm --filter pulse-sandbox test`
  - `pnpm --filter pulse-coder-memory-plugin test`
  - `pnpm --filter @pulse-coder/remote-server build`
- `apps/remote-server` is the webhook/server runtime. Its key files include:
  - `src/index.ts`
  - `src/server.ts`
  - `src/core/dispatcher.ts`
  - `src/core/agent-runner.ts`
  - `src/core/engine-singleton.ts`
  - `src/routes/internal.ts`
- Skill files use `.pulse-coder/skills/<skill-name>/SKILL.md` with YAML frontmatter.

### Common Feature Areas

| Need type | Start investigation here |
|---|---|
| Agent loop behavior | `packages/engine/src/core/loop.ts`, `packages/engine/src/context/`, `packages/engine/src/ai/` |
| Built-in tools | `packages/engine/src/tools/` |
| Plugin loading/hooks | `packages/engine/src/plugin/`, `packages/engine/src/built-in/` |
| Skills system | `packages/engine/src/built-in/skills-plugin/`, `.pulse-coder/skills/` |
| Task tracking | `packages/engine/src/built-in/task-tracking-plugin/` |
| Tool search/deferred tools | `packages/engine/src/built-in/tool-search-plugin/`, remote tool registration |
| CLI UX | `packages/cli/src/` |
| Remote Discord/Feishu runtime | `apps/remote-server/src/core/`, `apps/remote-server/src/platforms/`, `apps/remote-server/src/routes/` |
| Internal scheduled runs | `apps/remote-server/src/routes/internal.ts`, cron-related tools/routes |
| Memory | `packages/memory-plugin/`, `apps/remote-server/src/core/memory-integration.ts` |
| Worktree/vault binding | `packages/plugin-kit/`, `apps/remote-server/src/core/worktree/` |
| Canvas workbench | `apps/canvas-workspace/`, `docs/canvas-workspace-product/`, `docs/06-harness-engineering-roadmap.md` |

---

## Required Workflow

### Phase 0 — Scope Alignment

Identify the user’s intent:

| User intent | Deliverable |
|---|---|
| “分析当前项目” | Project map + health diagnosis + risks + immediate next steps. |
| “需求推进” | Requirement decomposition + priority + milestone plan + task board. |
| “做某个功能” | PRD-lite + technical plan + implementation slices + validation plan. |
| “排期/roadmap” | Sequenced roadmap with dependencies, owners/roles, confidence, and risks. |
| “直接干” | Create execution tasks, inspect repo, implement only after scope is clear. |

If the user does not specify a target area, default to **repo-wide analysis plus next 2–4 week plan**.

Ask up to 3 questions only if needed:
1. What is the target audience/user or business goal?
2. What timeframe or release deadline matters?
3. Are we planning only, or should we also implement the first slice?

If unanswered, continue with assumptions.

---

### Phase 1 — Repository Discovery

Run or inspect, as appropriate:

1. `pwd`, `git status --short`, `git branch --show-current`.
2. Workspace manifests:
   - `package.json`
   - `pnpm-workspace.yaml`
   - each relevant workspace `package.json`
3. Project guidance:
   - `README.md`, `README-CN.md`
   - `AGENTS.md`, `CLAUDE.md`
   - `docs/`, `architecture/`
4. Source topology:
   - top-level `packages/*/src`
   - top-level `apps/*/src`
5. Existing tests and scripts:
   - `*.test.ts`, `*.spec.ts`
   - package `scripts`
6. Recent work context when useful:
   - `git diff --stat`
   - `git log --oneline -10`

Do not read huge generated folders such as `dist/`, `node_modules/`, release outputs, session stores, or private memory data unless directly relevant.

---

### Phase 2 — Project Map

Produce a concise system map:

1. **What the product is** — one paragraph.
2. **Architecture layers** — runtime, tools, plugins, clients/apps, storage/integration.
3. **Key modules and ownership boundaries**.
4. **Primary data/control flows**, for example:
   - user input → platform/CLI → dispatcher/runner → engine loop → tools/plugins → response streaming
   - skill loading → registry → `skill` tool → detailed instructions
5. **Operational entrypoints** and important commands.
6. **Known docs vs code mismatches** if any.

Mark each claim as:
- `Fact` — verified from repo evidence.
- `Inference` — reasoned from evidence.
- `Assumption` — not verified.

---

### Phase 3 — Health Diagnosis

Assess the project across these dimensions:

| Dimension | Checkpoints |
|---|---|
| Product clarity | Who is the user? What job-to-be-done? What is the current wedge? |
| Architecture | Boundaries, dependency direction, plugin extensibility, runtime coupling. |
| Code quality | Type strictness, duplication, naming, local complexity, generated artifacts. |
| Testability | Existing tests, critical paths covered, missing integration/e2e tests. |
| Developer experience | Build scripts, targeted commands, docs, setup friction. |
| Runtime reliability | retries, abort, compaction, tool failure handling, state persistence. |
| Security | secrets handling, internal API protection, path/file operations, webhook verification. |
| Observability | logs, run IDs, latency traces, devtools, Langfuse/plugin hooks. |
| Delivery risk | blockers, unclear requirements, migrations, third-party APIs, platform quirks. |

Use severity:
- `P0` — blocks correctness/security/release.
- `P1` — important for near-term delivery.
- `P2` — improves maintainability or UX.
- `P3` — future optimization.

---

### Phase 4 — Requirement Intake and Decomposition

For each need, create a PRD-lite block:

```md
## Requirement: <name>

- Problem:
- Target user / scenario:
- Desired outcome:
- Non-goals:
- Constraints:
- Acceptance criteria:
  1. ...
  2. ...
- Success metrics:
- Dependencies:
- Risks:
- Open questions:
```

Then decompose into engineering slices:

```md
### Slice <N>: <small deliverable>
- Scope:
- Files likely touched:
- Implementation notes:
- Tests:
- Docs/ops updates:
- Rollback plan:
- Definition of Done:
```

Slices should usually fit in one focused PR/MR.

---

### Phase 5 — Prioritization

Use a lightweight scoring model unless the user provides another one.

Score each candidate 1–5:

| Factor | Meaning |
|---|---|
| Impact | User/business value if completed. |
| Urgency | Time sensitivity or blocking nature. |
| Confidence | Evidence quality and requirement clarity. |
| Effort inverse | 5 = small/easy, 1 = large/uncertain. |
| Risk reduction | How much this reduces future delivery risk. |

Suggested priority score:

```text
Priority = Impact + Urgency + Confidence + EffortInverse + RiskReduction
```

Then classify:
- `Now / P0`: must do immediately.
- `Next / P1`: next milestone.
- `Later / P2`: valuable but not blocking.
- `Park / P3`: explicitly defer.

Also identify dependencies: “A must happen before B because …”.

---

### Phase 6 — Roadmap and Execution Plan

Produce a roadmap at three resolutions:

1. **This week** — concrete tasks, validation, expected outputs.
2. **Next 2–4 weeks** — milestone sequence and dependencies.
3. **Later** — strategic backlog and unknowns to resolve.

Each milestone must include:

```md
## Milestone <name>
- Goal:
- User-visible outcome:
- Work slices:
- Validation plan:
- Release/rollback notes:
- Risks and mitigations:
- Exit criteria:
```

For implementation handoff, create a task plan:

```md
| Task | Priority | Owner/Agent | Dependencies | Validation | Status |
|---|---:|---|---|---|---|
```

If task-tracking tools are available, create/update tasks for accepted execution work.

---

### Phase 7 — Validation Gates

Every plan must include validation commands or checks.

For this repo, prefer targeted checks:

| Area | Suggested checks |
|---|---|
| Engine loop/tools/plugins | `pnpm --filter pulse-coder-engine test`; `pnpm --filter pulse-coder-engine typecheck` |
| CLI | `pnpm --filter pulse-coder-cli test`; `pnpm --filter pulse-coder-cli build` |
| Sandbox | `pnpm --filter pulse-sandbox test`; `pnpm --filter pulse-sandbox typecheck` |
| Memory | `pnpm --filter pulse-coder-memory-plugin test`; `pnpm --filter pulse-coder-memory-plugin typecheck` |
| Remote server | `pnpm --filter @pulse-coder/remote-server build` |
| Cross-package change | `pnpm run build`; targeted tests first, full build last |
| Docs/skill-only change | parse/read file, check frontmatter has `name` and `description`; no build required unless loader changed |

If validation cannot run, state why and provide the next best evidence.

---

## Required Output Format

Use this structure by default:

```md
# 项目分析与需求推进方案

## 1. 结论先行
- 当前判断：
- 最应该做的 3 件事：
- 最大风险：

## 2. 证据来源
| Evidence | Path/Command | What it supports | Confidence |
|---|---|---|---|

## 3. 当前项目地图
- 产品定位：
- 架构层次：
- 关键模块：
- 主要流程：

## 4. 健康诊断
| Area | Finding | Severity | Evidence | Recommendation |
|---|---|---:|---|---|

## 5. 需求拆解
<PRD-lite blocks>

## 6. 优先级排序
| Candidate | Impact | Urgency | Confidence | EffortInverse | RiskReduction | Priority | Tier |
|---|---:|---:|---:|---:|---:|---:|---|

## 7. Roadmap
### This week
### Next 2–4 weeks
### Later

## 8. 执行任务板
| Task | Priority | Dependencies | Validation | Status |
|---|---:|---|---|---|

## 9. 开放问题与决策点
- Decision needed:
- Assumption to verify:

## 10. 下一步
- Recommended immediate next action:
- If you want me to execute: <specific first slice>
```

---

## Quality Checklist

Before finalizing, verify:

- [ ] `git status --short` was checked or explicitly unnecessary.
- [ ] Claims are tied to evidence or marked as assumptions.
- [ ] Requirements have acceptance criteria.
- [ ] Priorities explain tradeoffs, not just labels.
- [ ] Roadmap includes dependencies and risks.
- [ ] Execution tasks are small enough for PR-sized work.
- [ ] Validation commands/checks are listed.
- [ ] User work and secrets are protected.

---

## Completion Criteria

This skill is complete when the user receives either:

1. A repo-wide project analysis plus prioritized roadmap, or
2. A focused requirement plan with task-level execution handoff, or
3. A clear blocker report explaining what information is missing and the minimum questions needed to proceed.
