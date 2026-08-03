# Focus Convergence Plan

Date: 2026-08-02
Status: direction agreed; surface convergence largely SHIPPED in v0.1.37
(#901) — see "Shipped vs remaining" below. Flag-lifecycle demotions and the
P0 core-loop work are the open items.

## Shipped vs remaining (v0.1.37, #901)

Shipped — all three layers landed in one PR, with new tests
(FloatingToolbar, Settings, SidebarHeader, CanvasEmptyHint):

- **Navigation**: Nodes AND Graph sidebar entries hidden via
  `NODES_NAV_VISIBLE / GRAPH_NAV_VISIBLE = false` in `App.tsx` — routes stay
  alive (node-detail flows still route through them), only the nav
  advertisement is gone. Goes further than this plan (which kept Nodes) in
  the same spirit.
- **Creation**: `TOOLBAR_SECONDARY_VISIBLE` hides shapes, plugin nodes, and
  agent teams ("kept implemented for a future More menu"); the hand/pan
  tool is hidden; a node type was hidden from creation. Mindmap KEPT on the
  toolbar — a deliberate deviation from this plan's 5-button target.
- **Settings**: consolidated into 3 rail groups — AI Chat / Agents &
  Extensions / App (this plan proposed 4; 3 achieves the same collapse).
- **First-run**: welcome workspace slimmed (~240 lines of seeded content
  removed), empty-canvas hint reworked; perf CI re-covered via
  `seed-fixture.mjs` since welcome content no longer seeds scenarios.

Still open:

1. Flag-lifecycle demotions (§4): `workspace-graph-page` / `dynamic-app` /
   `chat-channels` / `default-browser` exposures are unchanged in
   `experimental-features.ts`; nav hiding made the Graph flag's UI moot but
   the Settings toggles still advertise the frozen subsystems.
2. Skills page fold into Settings (§1) — skills kept its route and got a
   loading polish instead; revisit or drop this line item.
3. Everything under "What the freed capacity buys": P0 file-watcher fix,
   frame-as-context, outputs-to-canvas; P1 resume; engine context-provider
   contract.

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
- **Engine**: demand-driven by canvas-workspace needs, not self-growing —
  and every demand lands as a host-agnostic mechanism (hook/tool/provider),
  never as canvas awareness inside the engine. First engine investment is a
  test baseline for the untested orchestrator module before new capability
  lands on top of it.

## Positioning: where the standout ("亮眼") lives

Competitive check (2026-08): the "infinite canvas + AI agents" category is
being validated fast. Slashspace (local-first spatial multi-model canvas),
Maestri (macOS orchestration canvas for coding agents), TermCanvas (parallel
Claude Code/Codex/Gemini terminals on a canvas), QuantaCanvas, and MindPal
Canvas all shipped or gained traction this year. Two consequences:

1. **"Agents on a canvas" is becoming commodity.** Parallel-terminal and
   orchestration canvases are already taken as demos. Do not compete there —
   which independently confirms freezing agent-teams/multi-role investment.
2. **"Canvas as the agent's context" is still open.** Competitors put agents
   ON a canvas; none makes the canvas BE the shared, persistent context the
   agent reads and writes, with provenance and resume. That is the standout
   position, and it spans both focal points as one capability:
   - **canvas-workspace**: spatial context is visible and manipulable —
     a frame IS the agent's working set (spatial prompting); agent outputs
     land as nodes with provenance edges to their sources; reopening restores
     everything.
   - **engine**: stays a general-purpose agent core — no canvas concepts
     ever enter it. Its contribution is a general structured-context
     contract: named context providers with priorities and token budgets,
     compaction that respects provider boundaries, memory anchors keyed by
     host-supplied ids. Today hosts inject context as prompt strings
     (canvas-workspace's `context-builder.ts` does exactly this); the
     contract upgrade is host-agnostic mechanism, per the root rule
     "extend plugin/hook/tool boundaries over hardcoding into loop.ts".
     canvas-workspace then maps frames/nodes/edges onto that contract,
     keeping all spatial semantics host-side. The engine's story is
     "the general agent core whose contract is proven by a heavyweight
     flagship host" (the VS Code pattern), not "canvas engine".

## North-star demo (acceptance bar for "亮眼")

Thirty seconds, no cuts:

1. Drag a project folder, two web pages, and a note onto the canvas.
2. Frame them; name the frame.
3. Tell the frame's agent: "调研这些材料,出方案,跑通测试。"
4. Watch the work happen spatially — a plan doc node appears, a terminal
   node runs tests live, the result artifact pins itself, every produced
   node wired by edges back to its sources.
5. Quit the app. Reopen: everything is exactly there, sessions alive.
6. Ask "上次做到哪了" — instant, correct resume from the map.

Every P0/P1 item above is a prerequisite of this demo; anything that does
not serve it should justify itself. Chat apps can't do steps 1–2, IDE agents
can't do step 4's spatial provenance, orchestration canvases can't do 5–6.

## Non-goals (unchanged from product-design.md, plus)

No browser, no IM platform, no generic app platform, no further multi-agent
orchestration surface until existing usage justifies it. Multi-user
collaboration, cloud sync, and web deployment remain out.
