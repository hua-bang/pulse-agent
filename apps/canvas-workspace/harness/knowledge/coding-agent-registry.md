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
| Brand mark | a `case` in `AgentNodeBody/AgentIcon.tsx` (inline SVG; the `default` case is a generic clock glyph, so a missing case is visible as "not really supported") |
| Brand color | `--agent-brand-<id>` in `src/renderer/src/styles.css`, plus the idle and active `right-dock__tab-icon--agent-<id>` rules in `RightDock/index.css` and the `BRANDED_AGENT_TYPES` list in `RightDock/DockAgentTabIcon.tsx` |
| Dock tab title | the `agentDefaultTitle` chain in `RightDock/TerminalDockTab.tsx` |
| Install guide | `AGENT_INSTALL_GUIDES` in `AgentNodeBody/AgentPicker.tsx` — shown when the binary probe reports missing or a launch fails |
| Command detection | `CODING_AGENT_COMMAND_PATTERN` + the return chain in `utils/codingAgentCommand.ts`, so typing the CLI into a terminal node/dock is recognized as an agent session |
| Canvas Agent delegation | the `agentType` enum in `src/main/agent/tools/agents.ts` and the data-shape prose in `src/main/agent/tools/nodes.ts` |

The brand color lives in `styles.css`, not `RightDock/index.css`, because the
dock's tab switcher renders these icons inside a body-level popover — a token
scoped to `.right-dock` would not resolve there.

`.agent-tabs` derives its grid track count from `--agent-tab-count`, which
`AgentPicker` sets from `AGENT_REGISTRY.length`. Adding an entry widens the
row instead of wrapping onto a half-empty second line; labels ellipsis at
narrow node widths.

## Per-agent launch behavior

`AgentNodeBody/useAgentNodeController.ts` composes the shell line. Everything
agent-specific there is opt-in — an id it does not recognize gets a bare
`<command> [prompt]`, which is the correct default for a CLI that takes its
prompt positionally and needs no flags.

- **Approval bypass.** The "skip permission prompts" toggle only renders when
  `AgentPicker` maps the id to a flag (`--dangerously-skip-permissions` for
  Claude Code, `--dangerously-bypass-approvals-and-sandbox` for Codex). Pi
  executes tools without asking by default, so it has no flag and no toggle.
  Keep the picker's flag map and the controller's `dangerousFlag` chain in
  sync — they are two copies of the same mapping.
- **Resume.** `AgentRestart` offers "resume" only for an agent whose node
  holds a stable conversation id: Claude Code because `--session-id <uuid>`
  assigns one at launch, Codex because the session file is discovered
  afterwards by marker (`main/agent/codex-sessions.ts`). An agent that can
  only continue "the most recent session" gets restart, NOT resume — a
  `--continue`-style fallback can attach the node to another agent's
  conversation. Pi is in this class: its `--session <path|id>` opens an
  existing session and cannot mint one at a caller-chosen id.

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
