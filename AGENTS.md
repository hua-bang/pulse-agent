# AGENTS.md

Global constraints and task routes; `CLAUDE.md` imports this file.

## 0. Meta rules (precedence + SSOT)

- Precedence: this file > affected workspace AGENTS > local harness/docs > root validation overlay. Lower layers refine, never contradict, the upper.
- SSOT: `pnpm-workspace.yaml` owns membership; package.json owns metadata/scripts; workspace AGENTS/harness own local roles, contracts, and knowledge. Do not copy inventories.
- Establish the problem, goal, constraints, and current evidence first; do not reverse-justify a change from an MR or neighboring code.
- Reuse existing modules, scripts, skills, and docs. Add assets only when existing entries cannot carry the work and the addition reduces complexity or enforces a constraint. Newness is not a reason.
- Prefer plugin/hook/tool/service boundaries over engine-loop hardcoding. Verify that enforcement actually exists; a documented gate is not a runner.
- Maintain AGENTS by decision value and ownership: keep necessary scoped constraints and task routes; apply the content-admission principles in `harness/DESIGN.md`. Length metrics are observational.

Self-check: evidence, reuse, smallest change, SSOT/consumers, executable guard (or why only documentation).

## 1. Routing

Read `harness/README.md`, the affected workspace AGENTS, and local validation. Follow task-matched routes; detailed resources are required when their trigger applies.

| Task / trigger | Required owner or protocol |
|---|---|
| Engine, plugins/tools, compaction/offload, MCP/runtime config, orchestration | `packages/engine/AGENTS.md` |
| Terminal CLI / host behavior | `packages/cli/AGENTS.md` |
| Canvas app, renderer, shortcuts, embedded browser | `apps/canvas-workspace/AGENTS.md` |
| Canvas CLI / storage concurrency | `packages/canvas-cli/AGENTS.md` |
| Remote adapters, dispatcher, internal routes | `apps/remote-server/AGENTS.md` |
| Team coordination / ACP / plugin infrastructure | `packages/agent-teams/AGENTS.md`, `packages/acp/AGENTS.md`, or `packages/plugin-kit/AGENTS.md`, according to the changed package |
| Canvas capability shared by Tool + CLI | `harness/skills/add-canvas-capability/SKILL.md` |
| Add/remove workspace | `pnpm-workspace.yaml`; its AGENTS and local validation; root overlay if impact changes |
| Harness governance / documentation structure | `harness/DESIGN.md`, `harness/README.md`, `harness/ROADMAP.md` |
| Harness visualization / entry slimming | `harness/skills/visualize-harness/SKILL.md` or `harness/skills/slim-agents-md/SKILL.md` |

## 2. Hard boundaries (real values)

- Use pnpm pinned by root package.json, never npm/yarn. Node is unpinned.
- Keep TypeScript strict. Canvas tsconfigs are independent. Match each package's module format and scripts.
- Root `tsconfig.json` owns aliases; do not invent them. Other internal dependencies use `workspace:*`.
- No lint/format tool is configured. Match local style: two spaces, semicolons, single quotes.
- Read workspace validation for test/build and coverage limitations. Passing tests do not prove untested modules.

## 3. Auxiliary-workspace boundary

`apps/devtools-web` is excluded from pnpm workspaces but remote-server still serves it; do not delete it. Serving details: `apps/remote-server/AGENTS.md`.

## 4. Prerequisites and automation

Before code/review: owning AGENTS + local validation. Before contract changes: affected contracts + root overlay. Before docs: nearest owner + `harness/DESIGN.md`.

Performance and harness-integrity CI are defined. Bound workspace acceptance still runs manually; the integrity workflow only checks harness code/data and plans commands. See `harness/validate/README.md`. Qualify further enforcement before enabling it.

Repo protocols live in harness/skills; product skills in .pulse-coder/skills. Use existing protocols; add one only for stable recurring work.

## 5. Acceptance (reproducible + verifiable)

Run `node scripts/harness/run-harness-check.mjs --level standard` for completed changes; quick for iteration, release for relevant performance/release evidence. Use explicit paths to scope unrelated work. Escalation reminders require judgment and manual execution.

Include Canvas explicitly when affected: root core build/test excludes it. Full-sweep and evidence details: `harness/validate/README.md`.

Harness edits must pass `node scripts/harness/check-harness.mjs` with `harnessGaps: 0`. Report executed checks, results, and unverified scope; dry-run/structural success is not full acceptance.

## 6. Failure capture (named failure -> guard)

Before changing a failure-sensitive boundary, read its existing guards:

| Boundary | Required detail |
|---|---|
| History cleanup / later user turns | `packages/engine/harness/knowledge/loop-lifecycle.md` |
| Tool blocking I/O, UTF-8, shell argument safety | `packages/engine/harness/knowledge/tools-reference.md` |
| Engine/plugin logging in terminal hosts | `packages/engine/harness/knowledge/host-integration.md` |
| MCP scope activation / fresh reload | `apps/canvas-workspace/harness/knowledge/plugin-market.md` |
| Hidden webview capture / guest lifetime | `apps/canvas-workspace/harness/knowledge/dock-browser.md` |
| CLI write locks / app-versus-CLI arbitration | `packages/canvas-cli/harness/knowledge/storage-concurrency.md` |
| Menu, registry, and terminal shortcut ownership | `apps/canvas-workspace/harness/knowledge/keyboard-shortcuts.md` |

Preserve guards; new history cleanup needs a regression test. Cross-check tests against their script before claiming no coverage. Debug with `git log -- <file>` and focused tests, not TODO searches.

Write back: facts -> owning Knowledge; checks -> local validation; procedures -> existing Skills. Update the existing owner, consolidate duplicate rules, and retire source-verified obsolete guidance. Entry changes must satisfy the content-admission principles; retain the constraint or trigger with its owner pointer. No task-log accumulation or separate feedback store.

## 7. Security / secrets

Never commit keys/tokens. Follow the env-only key policy in engine config-reference; plugin secrets use vault helpers. Remote internal routes stay loopback-only and require INTERNAL_API_SECRET.

## 8. .pulse-coder/ vs .coder/

Use .pulse-coder for new runtime config; preserve .coder compatibility unless explicitly migrating. Runtime layout, loaders, and inventory sources: `packages/engine/harness/knowledge/config-reference.md`.
