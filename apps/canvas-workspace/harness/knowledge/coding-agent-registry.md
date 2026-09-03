# Coding agents (the Coding Agent node's CLI roster)

The Coding Agent node launches a third-party coding CLI inside a PTY. Which
CLIs it offers is a cross-file contract: one registry entry drives the setup
tabs, but a usable agent also needs a brand mark, a dock identity, an install
guide, and a command-detection arm. Read this file before adding, removing,
or renaming a coding agent, and before changing per-agent launch flags.

## Registry: the SSOT

`src/renderer/src/config/agentRegistry.ts` owns the roster. Each `AgentDef`
is `{ id, label, command, description }`, where `command` is the binary the
node spawns (probed at setup time via `pty.checkCommand`, so a missing binary
disables that tab rather than failing at launch) and `description` is the
vendor shown in the tab tooltip. `getAgentCommand(id)` is the only supported
way to resolve a launch binary; `useAgentNodeController` treats an unknown
id as "no command" and refuses to launch.

Current roster: `claude-code` (`claude`), `codex` (`codex`), `pi` (`pi`).

## Adding an agent

The registry entry alone renders a working tab. These land with it:

| What | Where |
|---|---|
| Brand mark | a `case` in `AgentNodeBody/AgentIcon.tsx` (inline SVG; the `default` case is a generic clock glyph, so a missing case is visible as "not really supported") — see "Brand marks" below |
| Brand color | `--agent-brand-<id>` in `src/renderer/src/styles.css`, plus the idle and active `right-dock__tab-icon--agent-<id>` rules in `RightDock/index.css` and the `BRANDED_AGENT_TYPES` list in `RightDock/DockAgentTabIcon.tsx` |
| Dock tab title | the `agentDefaultTitle` chain in `RightDock/TerminalDockTab.tsx` |
| Install guide | `AGENT_INSTALL_GUIDES` in `AgentNodeBody/AgentPicker.tsx` — shown when the binary probe reports missing or a launch fails |
| Command detection | `CODING_AGENT_COMMAND_PATTERN` + the return chain in `utils/codingAgentCommand.ts`, so typing the CLI into a terminal node/dock is recognized as an agent session |
| Canvas Agent delegation | the `agentType` enum in `src/main/agent/tools/agents.ts` and the data-shape prose in `src/main/agent/tools/nodes.ts` |

The brand color lives in `styles.css`, not `RightDock/index.css`, because the
dock's tab switcher renders these icons inside a body-level popover — a token
scoped to `.right-dock` would not resolve there.

## Brand marks

Use the vendor's real mark, taken from a source you can cite in the code
comment (press kit, website repo, or the published package) — not a drawn
approximation. Current provenance: Claude Code and Codex use their vendors'
wordless glyphs; `pi` uses pi.dev's `logo.svg`, whose geometry is identical
in the site repo's `src/logo.svg`, `src/favicon.svg`, and the `logo-auto.svg`
the upstream README embeds.

Two things to normalize when importing one:

- **Color.** A mark that ships colored (Claude's orange) keeps its literal
  fill. A mark the vendor ships monochrome — Codex, and Pi via its
  `logo-auto.svg` black/white pair — takes `fill="currentColor"`, which is
  the vendor's intent and lets `--agent-brand-<id>` and the active-tab accent
  tint it. Never paste an upstream `<style>` block: those class names
  (`.logo-mark`) are unscoped and would leak across the document.
- **Optical weight.** Source art is often padded inside a square canvas
  (Pi's is drawn with ~165u of margin in an 800u box). Tighten the `viewBox`
  to the path bounds so the mark carries the same weight at 14–16px as the
  marks that already fill theirs.

`.agent-tabs` derives its grid track count from `--agent-tab-count`, which
`AgentPicker` sets from `AGENT_REGISTRY.length`. Adding an entry widens the
row instead of wrapping onto a half-empty second line; labels ellipsis at
narrow node widths.

## Per-agent launch behavior

`modules/coding-agent/session/sessionLifecycle.ts` composes the shell line;
`AgentNodeBody/useAgentNodeController.ts` executes the resulting plan. Everything
agent-specific there is opt-in — an id it does not recognize gets a bare
`<command> [prompt]`, which is the correct default for a CLI that takes its
prompt positionally and needs no flags.

- **Approval bypass.** The "skip permission prompts" toggle only renders when
  `AgentPicker` maps the id to a flag (`--dangerously-skip-permissions` for
  Claude Code, `--dangerously-bypass-approvals-and-sandbox` for Codex). Pi
  executes tools without asking by default, so it has no flag and no toggle.
  Keep the picker's flag map and the controller's `dangerousFlag` chain in
  sync — they are two copies of the same mapping.
- **Resume.** See "Binding a node to one conversation" below. The rule the
  lifecycle interface enforces: `AgentRestart` offers "resume" only when the node can name
  its OWN conversation. A bare "continue the most recent session" fallback
  never qualifies — it can attach the node to a sibling node's conversation,
  or to one the user started by hand in a terminal.

## Binding a node to one conversation

A Coding Agent node is a long-lived thing: the app restarts, the PTY dies,
the user hits "Resume". For that to mean anything, the node must be able to
point at ONE conversation. Every CLI solves this differently, and the cost of
each mechanism is what decides whether resume is offered at all.

| Agent | Mechanism | Where it lives |
|---|---|---|
| Claude Code | caller-supplied id: `--session-id <uuid>` on first launch, `--resume <uuid>` after | `cliSessionId` on the node; `modules/coding-agent/index.ts` |
| Codex | discovered after the fact: a marker comment is appended to the first prompt, then `~/.codex/state_5.sqlite` is polled for the thread containing it (session-index diffing as fallback), then `codex exec resume <id>` | `codexSessionId` / `codexSessionMarker`; `main/agent/codex-sessions.ts` |
| Pi | private storage: `--session-dir <node dir>` on every launch, plus `--continue` to resume | `piSessionKey` on the node; `modules/coding-agent/index.ts` |

Prefer the cheapest mechanism the CLI actually supports, in this order:

1. **A caller-supplied id** (Claude Code). Deterministic, nothing to discover.
2. **A private session directory** (Pi). Also deterministic, and it needs no
   id at all — scoping storage collapses "the most recent session" from a
   machine-wide guess into an exact answer. Prefer this over discovery
   whenever the CLI exposes such a flag.
3. **Post-hoc discovery** (Codex). Only when neither of the above exists. It
   reads another tool's private on-disk state, so it is version-fragile, it
   must handle "found two candidates" as a distinct outcome, and its 30s
   poll can simply fail — after which the node has no resumable id.

### Pi's session directory

`pi --session-dir <dir>` scopes both where sessions are written and where
lookups search, so a node-private directory makes `--continue` — "the most
recent session in this directory" — resolve to that node and nothing else.
The node stores only an opaque UUID (`piSessionKey`); the path is derived in
`useAgentNodeController` (`piSessionDirArg`) as
`$HOME/.pi/agent/sessions/pulse-canvas/<key>`.

Four things about that path are load-bearing:

- **The flag ships on every launch, not just resumes.** It is what puts the
  first conversation somewhere a later `--continue` can find it.
- **Two levels below `sessions/`.** Pi's cross-project session list scans
  only the direct children of `sessions/`, so canvas conversations stay out
  of the CLI's `pi -r` picker while remaining reachable by path.
- **`$HOME`, not `~`.** Pi expands a leading tilde for its
  `PI_CODING_AGENT_SESSION_DIR` env var but NOT for `--session-dir`, so the
  shell has to do the expanding. The env var is not an option here anyway:
  `pty:spawn` allowlists env keys to `^PULSE_CANVAS_[A-Z0-9_]+$`.
- **The key is a UUID**, so the double-quoted path can never carry shell
  syntax.

A node whose first launch predates this binding has no key; its earlier
conversation sits in pi's default per-cwd directory and is not addressable
from the node, so the first keyed launch starts fresh and the restart card
says so.

Rejected: `pi -c` against the default directory. It resolves per working
directory, so two nodes on one repo — or a `pi` the user ran in a terminal —
silently share a conversation.

Tests: `AgentNodeBody/__tests__/piSessionBinding.test.tsx`.

## Not automatic

Two neighboring surfaces have their own rosters and do not pick up a new
registry entry:

- **Agent Teams** — `AgentTeamFrame`'s `TEAM_AGENT_OPTIONS` filters the
  registry down to Claude Code and Codex, and `main/agent-teams/canvas-nodes.ts`
  carries Claude-specific lead arguments.
- **External role drivers** — multi-role chat runs CLIs headlessly over a
  JSONL stream (`src/main/agent/external/`, families in
  `src/shared/agent-roles.ts`). A new family needs its own stream parser;
  a PTY registry entry is not enough.

## Tests

`AgentNodeBody/__tests__/AgentPicker.test.tsx` (one tab per registry entry,
grid track count, per-agent approval toggle),
`AgentNodeBody/__tests__/AgentIcon.test.tsx` (every registered agent has a
distinct mark, none falls through to the generic glyph),
`utils/__tests__/codingAgentCommand.test.ts` (detection, including that
`pip`/`ping` are not the Pi CLI),
`RightDock/__tests__/DockTabIcon.test.tsx` (branded dock icon slots).
