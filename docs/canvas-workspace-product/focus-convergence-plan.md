# Focus Convergence Plan

Date: 2026-08-02
Status: agreed direction; implementation pending as small PRs

## Decision

Two focal points for future investment: **`apps/canvas-workspace`** (the product
surface) and **`packages/engine`** (the agent core). Everything else is
supporting cast — frozen, hidden, or demand-driven.

The product theme is **focus**: the canvas is the shared, resumable working
context for the human and the agent. Context goes on the canvas, the agent
works inside that context, outputs land back on the canvas, and reopening a
workspace resumes everything. This restates the original vision in
`product-design.md` ("a living map of work ... without tab hunting") — the
convergence below removes what grew sideways from it.

## Evidence snapshot (why now)

- July 2026: 129 commits on canvas-workspace; ~28 chat, ~19 dock/browser/tabs,
  ~20 scheduled/memory, **~4 canvas core**. Gravity had drifted from canvas to
  chat.
- The only LIVE entry in `harness/knowledge/known-defects.md` sits on the
  vision's foundation: file-watcher sync is disabled, so external edits to
  file nodes are invisible until reload.
- Surface inventory at 0.1.36: 13 host node types + plugin system, 6+ routes,
  8 toolbar creation buttons, 11 settings sections, 4 off-by-default
  peripheral subsystems (default-browser, Feishu channel, dynamic apps,
  agent teams) totalling ~24k LOC.

## Convergence actions (hide, don't delete)

Hiding is the default instrument: flip flags / remove entry points, keep code
and rendering. Git history plus the `pre-slim-archive` precedent make
deletion recoverable later; hiding is one small PR now.

### 1. Navigation layer (routes + sidebar)

| Surface | Today | Target |
|---|---|---|
| Graph page (`workspace-graph-page`) | stable / on, sidebar entry | grandfathered / off (existing users keep it) |
| Skills page | sidebar entry | fold into Settings → Agent group; drop sidebar entry |
| Nodes page | stable / on | keep (knowledge-node core, active work) |
| Chat page | on | keep, but **feature-frozen** — chat is an aide, not the destination |
| Scheduled page | on | keep (operational surface for background runs) |

Target sidebar: Canvas, AI Chat, Nodes, Scheduled, Settings.

### 2. Creation layer (canvas node entry points)

Principle: creation surfaces advertise only the core work-map primitives —
**capture** (note/file, text, web reference), **execute** (terminal, coding
agent), **organize** (frame). Everything else stays creatable via the command
palette but leaves the toolbar/context-menu.

| Entry | Today | Target |
|---|---|---|
| Floating toolbar | note, text, frame, mindmap, web, coding agent, agent team, plugin (8) | note, text, frame, web, coding agent (5) |
| Mindmap | toolbar + menu | command palette only; existing mindmap nodes render unchanged |
| Agent team | toolbar (flag-gated) | palette only (flag already off by default) |
| Plugin node | toolbar | palette only (plugin system stays the sole extension path) |
| Shape overlay / image / group | as-is | frozen, untouched (saved-data types; no new investment) |

Hiding a node type's creation entry never removes its renderer — zero risk to
saved canvases. Node-type deletion (union/factory/CLI parity + migration)
stays out of scope.

### 3. Configuration layer (settings 11 → 4 groups)

| Group | Absorbs today's sections |
|---|---|
| Models | models |
| Agent | agent, built-in-tools, mcp, chat-roles, reply-style, skills (moved from sidebar) |
| General | language, updates |
| Advanced | experimental, plugins, browser |

Keep old `SettingsSection` ids as aliases — several surfaces deep-link via
`initialSection`.

### 4. Flag lifecycle demotions

`experimental-features.ts` exposure changes, one PR with tests:

- `workspace-graph-page`: stable/on → grandfathered/off
- `dynamic-app`: experimental → grandfathered
- `chat-channels`: experimental → grandfathered
- `default-browser`: experimental → grandfathered (must stay grandfathered,
  not stable/off — users who registered the OS handler need the toggle to
  unregister cleanly)
- Verify Settings → Experimental renders sanely when the visible list is
  empty for new users.

## Frozen list (no new investment)

canvas-workspace: multi-role/external-role chat (just shipped — collect
usage, no additions), agent teams, dynamic apps, Feishu channel,
default-browser, mindmap/shape features, full-page chat features.

Repo-wide: `apps/remote-server` (+ `apps/devtools-web` — do NOT delete;
remote-server serves it), `packages/cli`, `packages/agent-teams`,
`packages/acp`. `packages/canvas-cli` and `packages/plugin-kit` are inside
the two focal points' dependency circle and stay active.

## Tripwire deletion rule

No scheduled deletion work. The first time a frozen subsystem obstructs a
refactor, a bundle-size ratchet, or a security review, delete that subsystem
in that PR (tag the pre-deletion commit, `pre-slim-archive` style; remove its
harness knowledge, validation bindings, and tests in the same PR). First
candidates when tripped: default-browser (~250 LOC), Feishu channel
(~5.5k LOC) — both zero canvas-data coupling.

## What the freed capacity buys (the actual point)

- **P0 — close the core loop**: fix file-watcher sync through the
  `updatedAt` merge path (the LIVE defect) with a regression test; make
  selected nodes/frames a first-class, visible agent context; agent outputs
  land on the canvas by default.
- **P1 — resume & flow**: reopening a workspace restores terminals, agent
  sessions, and viewport; deepen focus mode (a frame as a focus context,
  silencing scheduled toasts/dock noise inside it).
- **Engine**: demand-driven by canvas-workspace needs, not self-growing.
  First engine investment is a test baseline for the untested
  orchestrator module before new capability lands on top of it.

## Non-goals (unchanged from product-design.md, plus)

No browser, no IM platform, no generic app platform, no further multi-agent
orchestration surface until existing usage justifies it. Multi-user
collaboration, cloud sync, and web deployment remain out.
