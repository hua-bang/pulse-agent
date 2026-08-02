# Multi-role chat (agent roles, relay, and external drivers)

Multi-role chat lets the user @-mention one or more named personas ("roles")
in a single AI Chat message. Addressing several roles turns the turn into a
RELAY, where each role replies in order and reads the earlier roles' labeled
replies from the shared history. A role can also be driven externally by a
local coding-agent CLI (Claude Code or Codex) instead of the built-in
engine. Read this before changing role-marker parsing or routing, the
relay/turn stream events, the agent@agent handoff policy, role rendering or
coloring in the composer/transcript/Settings, the external-driver adapters,
or how an aborted external-role segment is normalized into a stopped turn.

## Role contract, marker, and speaker-label SSOT

`src/shared/agent-roles.ts` is the shared contract used by both main and
renderer. Central pieces:

- `AgentRoleDefinition`: `{ id, name, color (#rrggbb), prompt, external?,
  createdAt, updatedAt }`. `external` is present only for an externally-driven
  role (see below).
- Mention marker: `@[role:<id>|<name>]`, built by `buildRoleMentionMarker`
  and parsed by `parseRoleMentions` / `parseFirstRoleMention`. Per the
  module's own top-of-file comment: "The main process derives the active
  role for a turn by parsing the FIRST role marker from the message — there
  is no separate roleId IPC field, so edit/regenerate flows that replay the
  original message text keep their role for free."
- Speaker-label SSOT: `formatSpeakerLabel(name)` returns `【${name}】`, and
  `labelAssistantContent(content, speakerName)` prepends that label to the
  content when a speaker name is present. Both model-history
  label-injection points (see below) go through this helper.
- Stream payload types: `RoleTurnStartEvent { index, total, speakerRole,
  queue }`, `RoleTurnEndEvent { index, total, response, runId?,
  speakerRole }`, and the shared `RoleTurnRoleRef { id, name, color,
  namedBy? }`.
- Validation limits shared by UI and store: `AGENT_ROLE_NAME_MAX_LENGTH` =
  20, `AGENT_ROLE_PROMPT_MAX_LENGTH` = 4000, `AGENT_ROLE_COLORS` (the
  default swatch palette), `isValidAgentRoleColor`, `sanitizeAgentRoleName`
  (strips `[`, `]`, `|`, `@`, and newlines because those characters are
  marker syntax).

## Persistence and IPC (global role library)

`src/main/agent/roles-store.ts` + `src/main/agent/agent-roles-ipc.ts` own
the role library. It is ONE global library at `~/.pulse-coder/canvas/roles.json`
shared by every chat scope (per-workspace chats, global chat, scheduled-task
chats), so a persona defined once is @-mentionable everywhere. The file
holds both the role array and library-level `settings` (see the handoff
switch below); `readLibrary`/`writeLibrary` read and write both together,
and `writeRoles` re-reads `settings` before writing so a role edit/create/
delete round-trip never clobbers the settings half.

IPC channels, all prefixed `agent-roles:`:

- `agent-roles:list` — all roles.
- `agent-roles:save` — create (no `id`) or update (with `id`) one role.
- `agent-roles:delete` — remove one role by id.
- `agent-roles:settings-get` / `agent-roles:settings-save` — library
  behavior settings (the agent@agent handoff switch).
- `agent-roles:external-probe` — health check for a driver family: is its
  CLI on `PATH`, and which version.

The preload surface is `window.canvasWorkspace.agentRoles`
(`AgentRolesApi` in `src/shared/agent-roles.ts`), exposing `list`, `save`,
`remove`, `getSettings`, `saveSettings`, `externalProbe`.

## Persona injection and the relay boundary policy

`src/main/agent/role-turn.ts` owns:

- `formatActiveRoleSection(role, relay?, handoff?)` — the persona section
  appended to the system prompt when a role speaks: it embeds
  `role.prompt` inside `<role_persona>` tags, explains the 【Name】 labeling
  convention, and — when the turn is a relay (`relay.total > 1`) — tells the
  role its position ("speaker N of total") and instructs it to "Form your
  OWN judgment first... Disagree openly when you disagree." When the turn
  supports handoff, it lists the other @-able names and says the role may
  hand off "ONLY when their perspective is genuinely needed." It also tells
  the model: "When the user asks for many rounds, deliver them by @-ing the
  next speaker at the end of your turn; the system keeps the discussion
  going round by round."
- `formatRoleHistoryNote()` — appended when the CURRENT turn is the default
  assistant but the session already has labeled role replies, so the
  default assistant understands what 【Name】 prefixes mean.
- BOTH model-history label-injection points, which MUST stay in lockstep:
  - live push: `applySpeakerLabelToResponseMessages(messages, speakerName)`
    — mutates the just-produced response messages in place (shared by
    reference with the live model history, so the NEXT segment reads the
    label too).
  - session reload: `sessionMessageToModelMessage(message)`, DEFINED in
    this same file but INVOKED from `src/main/agent/canvas-agent.ts` at
    every point session messages are mapped back into model messages
    (initial restore, branch, delete, load, and general session-load —
    each site does `.messages.map(sessionMessageToModelMessage)`). The
    module's own top-of-file comment names this as the session-reload
    injection point and says both this and the live-push path "go through
    shared `labelAssistantContent`, guarded by role-turn tests."
  Diverging these two is exactly what "roles start impersonating each
  other" — see the module doc comment.
- The relay boundary policy, `shouldRunRelaySegment(index, { aborted,
  stopRequested })`: `false` if `aborted`; `false` if `stopRequested &&
  index > 0`; `true` otherwise. Segment 0 always runs even if a stop was
  already requested before the turn started.
- The impersonation guard, `sanitizeRoleSegmentText(text, speakerName,
  knownRoleNames)` (+ helper `stripSpeakerSelfLabels`): strips a leading
  self-label and truncates a segment's raw reply at the first line/sentence
  that starts with another known role's 【Name】 label, because the model
  sometimes tries to write every speaker's turn inside one segment.
  `replaceFinalAssistantText(messages, text)` pushes the sanitized text back
  into the live model history so the trimmed part never reaches the next
  speaker.
- `resolveActiveRoles(message)` / `resolveActiveRole(message)` — resolve
  ALL (or just the first) role markers in a message against the live
  library, silently dropping stale (deleted-role) mentions.

All of the above is pinned by `src/main/agent/__tests__/role-turn.test.ts`,
including a dedicated `describe('speaker-label injection points stay in
lockstep', ...)` block and a `describe('shouldRunRelaySegment (graceful-stop
boundary)', ...)` block.

## Routing: marker parsing → single turn vs. relay

Routing parses ALL role markers out of the message text on the MAIN side
(`parseRoleMentions`), order-preserving and id-deduped:

- one role marker → a single persona turn;
- several role markers → a RELAY, where each role runs as its own engine
  segment against the shared history, so segment N+1 reads segment N's
  labeled reply.

Edit/regenerate replays simply re-run the whole turn with zero extra
plumbing: because there is no separate roleId IPC field, replaying the
original message text re-parses the same markers and reconstructs the same
single-turn-or-relay shape for free.

## Speaker attribution: clean storage, per-message snapshot

Stored message content always stays clean — the 【name】 label exists only
on the MODEL-FACING copy (built by the injection points above), never in
what gets persisted to session history. Speaker name/color are PER-MESSAGE
snapshots (`speakerRoleId`, `speakerRoleName`, `speakerRoleColor` on the
persisted `CanvasAgentMessage` / renderer `AgentChatMessage`), so a message
keeps showing who said it and in what color even after the role that spoke
is later renamed, recolored, or deleted from the library.

## Stream protocol and graceful vs. hard stop

Per `src/main/agent/ipc.ts`'s channel doc comment:

- Every turn emits a `role-turn-start` / `role-turn-end` pair PER SEGMENT,
  on `canvas-agent:role-turn-start:{sessionId}` and
  `canvas-agent:role-turn-end:{sessionId}` (subscribed in
  `src/preload/bridge/agent.ts`, pushed from `src/main/agent/prepared-chat.ts`).
  A single-speaker turn still emits exactly one pair, with `total=1`. A
  relay emits one pair per speaking role, and `role-turn-start` carries the
  FULL relay `queue` (so the renderer can draw progress from the very first
  event).
- `role-turn-end` fires only for a segment that completed SUCCESSFULLY — a
  failed segment surfaces through the turn's `canvas-agent:chat-complete`
  error instead, not through `role-turn-end`.
- `canvas-agent:stop-relay` is the GRACEFUL boundary stop: the currently
  speaking segment finishes normally, and only the FUTURE queued segments
  are skipped. Main-side this is `CanvasAgentService.stopRelayForScope(scope)`
  → `CanvasAgent.stopRelay()`, which just flips a per-turn `{ stopped:
  boolean }` flag (`currentRelayStop`) that `shouldRunRelaySegment` reads
  every loop iteration (see above). Renderer-side it is
  `hooks/useChatRunControls.ts`'s `stopRelay()`, wired to `RelayBar`'s Stop
  button (label "停止接龙" / "Stop relay").
- The composer's own stop control calls `abort()` in the same
  `useChatRunControls.ts` (→ `canvas-agent:abort`, "interrupt the
  currently-running chat turn (hard stop)" per the ipc.ts doc comment) —
  this remains the HARD stop: it fires the turn's `AbortController`
  immediately, mid-segment, rather than waiting for the current speaker to
  finish.

## Agent@agent handoff policy (P2, opt-in)

The library-level switch `allowRoleHandoff` (type `AgentRoleLibrarySettings`)
lives in `roles.json`'s `settings`, edited from Settings → the **Chat
Roles** section (`RolesSection` in `src/renderer/src/components/chat/RolesSettings.tsx`,
Settings section id `chat-roles`) through `agent-roles:settings-get` /
`agent-roles:settings-save`. Default is OFF
(`DEFAULT_AGENT_ROLE_SETTINGS = { allowRoleHandoff: false }`); role writes
preserve the setting, since `roles-store.ts`'s `writeRoles` always reads the
current `settings` before writing the roles array back out.

When ON, each ROLE segment's reply (never the default assistant's — see
below) is scanned for plain-text `@RoleName` mentions with
`findRoleNameMentions(text, names)`. This is NAME-based, not
marker-based, because models write ordinary group-chat `@name` addresses in
their replies and never emit the internal `@[role:...]` marker syntax.
Matching is longest-name-first with span consumption (so with roles "评审"
and "评审员", the text "@评审员" counts only for 评审员) and
case-insensitive for ASCII names. Matches are appended to the SAME turn's
relay queue.

The append policy lives in `resolveHandoffRoles(replyText, { speaker,
libraryRoles, pendingIds, capacity })`:

- the speaker itself is always dropped (never hands off to itself);
- roles already waiting in the queue are deduped out (not re-added);
- roles that already SPOKE earlier in the turn MAY re-enter — that is how
  back-and-forth discussion works;
- growth is capped: the call site passes `capacity: ROLE_RELAY_MAX_SEGMENTS
  - segments.length`, so the queue never exceeds `ROLE_RELAY_MAX_SEGMENTS`
  = 30 total segments. The cap bounds AUTO-GROWTH from handoffs only —
  user-named speakers (the roles the user originally @-mentioned) are never
  truncated. "Stop relay" (above) is the way to end a long auto-growing
  discussion early — the Settings hint literally says "up to 30 turns; Stop
  relay ends it early."

Auto-appended queue entries carry `namedBy` (the name of the role whose
reply @-mentioned them in). `RelayBar.tsx` renders those steps with a
dashed underline —
`.chat-relay-step--handoff { text-decoration: underline dashed; }` in
`src/renderer/src/components/chat/ChatPanel.css` — and a tooltip using the
`roles.relayNamedBy` i18n key ("由 {name} 点名" in the zh locale, "Brought
in by {name}" in en). Because a handoff can turn what started as a
single-role turn into a relay mid-turn, the RelayBar can appear AFTER the
turn has already started — pinned by
`src/renderer/src/components/chat/hooks/relayTurnHandlers.test.ts`'s case
"surfaces the bar mid-turn when a handoff grows a single-role turn into a
relay."

Default-assistant segments (no role — `role` is `null`) never hand off, and
a pending graceful stop freezes the queue: in `src/main/agent/canvas-agent.ts`
the handoff scan is gated on `handoffEnabled && role && !relayStop.stopped
&& !stopped`, so once a stop is requested no further handoffs are appended.

## Renderer surfaces and the role-color cache

- Mention popup: roles form the `'role'` mention-item group and are listed
  FIRST in the `@` popup — `src/renderer/src/components/chat/hooks/useMentions.ts`'s
  own comment: "Chat roles lead the popup — addressing a persona is the
  primary reason to type `@` in a role-enabled conversation."
- Speaker badge: `src/renderer/src/components/chat/ChatMessage.tsx` renders
  `message.speakerRoleName` / `message.speakerRoleColor` as the avatar
  initial and a name badge on assistant messages.
- Per-segment bubbles + completion policy:
  `src/renderer/src/components/chat/hooks/relayTurnHandlers.ts`
  (`createRelayTurnHandlers` opens a fresh attributed bubble on
  `role-turn-start` and freezes it with the authoritative response +
  speaker snapshot on `role-turn-end`, so the NEXT segment's deltas can
  never bleed into a finished one; `applyTurnCompletion` is the
  final-merge policy at `chat-complete` for whatever segment is still
  in-flight) — tested by `relayTurnHandlers.test.ts`.
- Progress strip: `src/renderer/src/components/chat/RelayBar.tsx`.
- Settings editor: `src/renderer/src/components/chat/RolesSettings.tsx`,
  behind the Settings **Chat Roles** (`chat-roles`) section.

Role accents everywhere come from ONE renderer cache,
`src/renderer/src/components/chat/hooks/roleMentionItems.ts`: it caches the
`@` popup entries plus an id → accent-color map with a 5-SECOND TTL
(`loadRoleMentionItems`, `cache.at`), exposed to components as
`useRoleColors()` (and `useRoleNameColors()` for the plain-text `@Name`
form an agent writes when handing off), and invalidated immediately by
Settings save/delete (`invalidateRoleMentionItems()`, called from
`useAgentRoles`'s `save`/`remove` in `RolesSettings.tsx`). Chips recolor by
overriding the `--role-accent`, `--role-accent-icon`, `--role-accent-soft`
CSS custom properties INLINE per chip in
`src/renderer/src/components/chat/utils/mentions.ts`, so an unknown or
deleted role id simply falls back to the chip class's default violet
tokens instead of erroring.

## Externally-driven roles (local coding-agent CLIs)

Setting `AgentRoleDefinition.external = { family: 'claude-code' | 'codex',
cwd? }` (`AgentRoleExternalDriver`, families enumerated in
`AGENT_ROLE_EXTERNAL_FAMILIES`) routes that role's segments to
`src/main/agent/external/` instead of the built-in engine, via the turn
backend boundary (`src/main/agent/backends/`): `executeCanvasAgentSegment`
(`src/main/agent/segment-execution.ts`) resolves `resolveTurnBackend(role)`
— a role with an external driver runs on `externalCliTurnBackend`, which
calls `runExternalRoleSegment` (`src/main/agent/external/segment.ts`);
everything else runs on `engineTurnBackend` (`engine.run(...)`). The
executor keeps the backend-AGNOSTIC policies for every backend: it
pre-wraps `onText` so streamed deltas accumulate into `streamedText` on
BOTH paths (a hard-stopped engine segment preserves its partial text the
same way an external one does), collects response messages through one
`recordResponseMessages` recorder, and applies the stopped-vs-failed abort
normalization below. Each backend declares a capability matrix
(`nativeCanvasTools`, `clarifications`, `historyFidelity`,
`sessionResume`) for future per-backend UI degradation; additional native
backends (e.g. a pi-backed default assistant — see
`docs/09-agent-backend-boundary.md`) plug in at `resolveTurnBackend`
without touching the chat pipeline. Guards:
`src/main/agent/segment-execution.test.ts`,
`src/main/agent/backends/registry.test.ts`.

- Headless CLI spawn: Claude Code runs as `claude -p --output-format
  stream-json --verbose --include-partial-messages` (`buildClaudeCodeArgs`
  in `src/main/agent/external/claude-code.ts`), with the prompt piped
  through STDIN (avoids `ARG_MAX` on long transcripts, per that file's
  header comment).
- Session continuity: `--resume <sessionId>` (Claude Code) / `codex exec
  resume <sessionId>` (Codex), keyed per (chat-session × role) in
  `~/.pulse-coder/canvas/external-agent-state.json`
  (`src/main/agent/external/state-store.ts`, `getExternalSessionId` /
  `saveExternalSessionId` / `clearExternalSessionId`, key
  `` `${chatSessionId}:${roleId}` ``). A stored id is only reused while the
  role's `family` AND resolved `cwd` are unchanged — a driver edit starts a
  fresh CLI session.
- Stale-resume retry: `runExternalRoleSegment` in
  `src/main/agent/external/segment.ts` runs once with the stored
  `sessionId`; if that throws, the run was NOT aborted by the user, and the
  error message matches `RESUME_FAILURE_RE = /session|conversation|resume/i`,
  it clears the stored session id and retries exactly once on a fresh
  session (stale ids are the common cause of a resume failure).
- Tolerant line parsers: `consumeClaudeStreamLine` /
  `consumeCodexStreamLine` ignore unknown event/message types by design, so
  CLI version drift degrades to coarser streaming instead of a crash — the
  Claude adapter's own comment notes "the real 2.1.220 stream already
  carries kinds we don't model." Both parsers are pinned against real
  binary-shaped fixtures (including unrecognized event types) in
  `src/main/agent/__tests__/external-driver.test.ts`.
- The reply is appended to the shared model history BY HAND
  (`segment-execution.ts` pushes `{ role: 'assistant', content: resultText
  }` into `responseMessages` / `appendMessages` itself, since an external
  CLI never calls the engine's `onResponse`), so the label/persist/handoff
  tail downstream is identical to a normal engine segment's.
- CWD resolution chain (`resolveExternalCwd` in
  `src/main/agent/external/cwd.ts`, called from `segment.ts` before every
  run): an explicit `role.external.cwd` pin wins, and if that configured
  directory does not exist on disk it throws `External role working
  directory does not exist: <path>` — a config error, never a silent
  fallback. With no configured cwd: the chat's current workspace root
  folder (if it exists) is used, so @-ing the same external role from a
  different workspace runs it against that workspace's project; failing
  that, a per-role scratch directory
  `~/.pulse-coder/canvas/agent-home/<roleId>` is auto-created, so a
  pure-discussion external role needs zero folder preparation.

Tool activity is surfaced: both adapters translate their own event
vocabulary — Claude's `tool_use` / `tool_result` content blocks; Codex's
dialect-A `exec_command_begin/end`, `patch_apply_begin/end`,
`mcp_tool_call_begin/end`, `web_search_begin/end` protocol messages AND
dialect-B `item.started` / `item.completed` thread events — into the SAME
`onToolCall` / `onToolResult` shape the built-in engine path emits, via the
shared helpers `startTool` / `finishTool` in
`src/main/agent/external/tool-events.ts`. Per that module's own
"Robustness rule": a result whose call was never seen (dialect drift, a
begin event this app does not model) still emits a synthetic call first —
"a chip with an unknown name beats a silent gap." Tool results are
truncated at `TOOL_RESULT_MAX_CHARS` = 4000 chars
(`truncateToolResult`). The collected tool calls are mirrored into a
persistable `CanvasAgentToolCall[]` list as they stream
(`runExternalRoleSegment` in `segment.ts`), so a reloaded session keeps the
same chips the live run showed.

The persona prompt is OPTIONAL for external roles — they carry their own
`CLAUDE.md`/`AGENTS.md` instructions in their working directory, and
`renderExternalSegmentPrompt` (`src/main/agent/external/prompt.ts`) simply
omits the `<role_persona>` block when `role.prompt` is empty. Persona
(non-external) roles still require a non-empty prompt:
`roles-store.ts`'s `saveAgentRole` throws `'Role prompt is required'` when
`!prompt && !external`.

### Safety posture

- External roles respond ONLY to a DIRECT user `@` mention. Agent@agent
  handoff never targets them: `handoffTargetRoles(roles)` in
  `src/main/agent/role-turn.ts` filters out any role with an `external`
  driver before it is used to build BOTH the handoff target library and the
  advertised `@names` list a persona role is told about. Pinned in
  `src/main/agent/__tests__/external-driver.test.ts`'s `describe('handoff
  target policy', ...)` — "external roles are never handoff targets;
  persona roles remain."
- CWD existence is checked up front with a clear config error (see the CWD
  resolution chain above) rather than silently substituting a fallback
  directory for a configured-but-missing path.
- Permissions defer entirely to the CLI's own local configuration: neither
  adapter passes any permission/sandbox flag. Per each adapter's header
  comment, Claude Code "obeys the user's own Claude Code settings for that
  cwd" and Codex "obeys the user's own Codex config for that machine (same
  posture as Claude Code)" — this feature never escalates beyond what the
  user's own local agent config already allows.

### Codex adapter specifics

`src/main/agent/external/codex.ts` is the live Codex adapter:
`buildCodexArgs` produces `codex exec --json --skip-git-repo-check -`
(fresh session) or `codex exec resume <sessionId> --json
--skip-git-repo-check -` (resumed) — the trailing `-` is the stdin sentinel
that tells Codex to read the prompt from STDIN. `--skip-git-repo-check` is
required because a role's cwd is a user-chosen directory that may not be a
git repo; without it `codex exec` refuses to start. `consumeCodexStreamLine`
accepts BOTH JSONL dialects Codex has shipped: dialect-A protocol events
(`{ id, msg: { type, ... } }`, e.g. `agent_message_delta`, `task_complete`,
`session_configured`) and dialect-B thread events (`{ type: 'item.started'
| 'item.completed' | 'thread.started' | ... }`) — `--json` remains marked
experimental upstream, hence tolerating both.

### Env overrides and probe

- Probe IPC: `agent-roles:external-probe` → `probeExternalCli(family)` in
  `src/main/agent/external/runner.ts` runs `<cli> --version` with a 5s
  timeout and reports the first stdout line as the version.
- `PULSE_CANVAS_CLAUDE_CODE_CMD` — overrides the Claude Code binary
  (`claudeCodeCommand()` in `claude-code.ts`, default `claude`).
- `PULSE_CANVAS_CODEX_CMD` — overrides the Codex binary (`codexCommand()`
  in `codex.ts`, default `codex`).
- `PULSE_CANVAS_EXTERNAL_AGENT_STATE` — overrides the resume-state file
  path (`state-store.ts`, default
  `~/.pulse-coder/canvas/external-agent-state.json`).

## Chat tool entry (chat_role_list / chat_role_save)

`chat_role_list` / `chat_role_save` in `src/main/agent/tools/roles.ts` let
the user build @-mentionable roles by describing them in chat instead of
using the Settings editor. Because the role library is APP-level (one
global `roles.json` shared by every chat scope), both tools are registered
UNWRAPPED — i.e. not passed through the workspace-scoped
`requireWorkspaceId` wrapper — in BOTH tool factories in
`src/main/agent/tools/index.ts`: `createGlobalCanvasTools()` (global chat)
and `createCanvasTools(workspaceId)` (per-workspace chat). Both tools are
`defer_loading`. There is deliberately no `chat_role_delete` — removal
stays a Settings-only action — the same posture as the scheduled-task
tools (`chat_role_save`'s own description: "Deleting stays in Settings.").
`chat_role_save`'s description also restricts it to what the user asked
for in their own words: "ONLY when the user asked for the role in their
own words." A role the agent creates this way becomes @-mentionable in the
popup once the mention cache's 5-second TTL elapses (see the role-color
cache above).

## Stopped-vs-failed turn rule (external-role abort)

RULE: an external-role driver's rejection that happens AFTER its
`abortSignal` has fired is a STOPPED turn, never a FAILED turn. The turn
must preserve whatever partial text had already streamed, merge in any
live tool events the rejected driver's own return value could not carry,
and settle unfinished tools as cancelled (not failed).

Mechanism, in `src/main/agent/segment-execution.ts` and
`src/main/agent/chat-stop.ts`:

- `executeCanvasAgentSegment` wraps both the engine path and the external
  driver's `runExternalRoleSegment` call in one `try`. `onText` deltas are
  accumulated into a local `streamedText` as they arrive, independent of
  whatever the driver call eventually returns or throws. If the call
  throws AND `options.abortSignal.aborted` is true, the function does NOT
  rethrow — it returns normally with `resultText: ENGINE_ABORT_SENTINEL`
  (`chat-stop.ts`'s exported sentinel string, `'Request aborted.'`) and the
  accumulated `streamedText`. If the abort signal is NOT set, the same
  rejection rethrows as a real failure.
- The caller (`src/main/agent/canvas-agent.ts`) turns that into lifecycle
  state via `resolveSegmentOutcome({ signalAborted, resultText,
  streamedText })`: `stopped` is true when `signalAborted` OR `resultText
  === ENGINE_ABORT_SENTINEL`; the returned `rawText` is `streamedText` when
  stopped (never the sentinel, so the sentinel string is never shown to the
  user), or `resultText` (falling back to `'(no response)'`) otherwise.
- Live tool events that the rejected driver's own return value could not
  carry (because the throw happened before `runExternalRoleSegment`
  returned its `toolCalls` array) are captured separately: a
  `createFailedTurnToolTracker` (`src/main/agent/chat-failure-persistence.ts`)
  is wired as the segment's `onToolCall`/`onToolResult`/`onToolInputStart`/
  `onToolInputDelta`/`onToolInputEnd` callbacks, so it independently
  accumulates whatever tool activity streamed before the abort, regardless
  of how the driver call itself resolves. Its `snapshot()` is reset per
  segment (`failedTurnTools.reset()`).
- When `stopped` is true, `settleStoppedToolCalls(toolCalls,
  failedTurnTools.snapshot())` (`chat-stop.ts`) merges any tool from that
  tracker snapshot that is not already present in the segment's own
  `toolCalls` list (matched by `toolCallId`, falling back to `name`), then
  marks every tool still `'queued'` or `'running'` as `'cancelled'` with
  `error: 'Operation cancelled by user'` (unless it already carries its own
  error). Tools that already finished (`'succeeded'`/`'failed'`) are left
  alone.
- The persisted assistant message for a stopped segment sets
  `turnStatus: 'stopped'` and `retryable: true` (never `'failed'`); only an
  UNEXPECTED error reaching `CanvasAgent`'s outer `catch` (i.e. a real
  failure, not a recognized abort) produces a `'failed'`-status message via
  `failedAssistantMessage(error, failedTurnTools.snapshot())`.
- If the abort lands before ANY segment has started,
  `persistStoppedBeforeSegment` / `createStoppedBeforeSegmentOutcome`
  (`chat-stop.ts`) produce the same empty `turnStatus: 'stopped',
  retryable: true` message directly, without ever touching
  `ENGINE_ABORT_SENTINEL`-style text.

Guards: `src/main/agent/segment-execution.test.ts` (asserts a driver
rejection after `abortController.abort()` normalizes to
`resultText: ENGINE_ABORT_SENTINEL` with the partial `streamedText`
preserved, and that the in-flight tool call settles as `cancelled` with
`error: 'Operation cancelled by user'`) and `src/main/agent/chat-stop.test.ts`
(unit tests for `resolveSegmentOutcome`, `settleStoppedToolCalls`,
`createStoppedBeforeSegmentOutcome`/`persistStoppedBeforeSegment`, and
`linkRunAbortSignal`, including "preserves streamed partial text and never
exposes the engine abort sentinel").

## Evidence

Primary regression suites live in:

- `src/main/agent/__tests__/role-turn.test.ts` — marker resolution, persona
  sections, `shouldRunRelaySegment`, the impersonation guard, and the
  lockstep speaker-label injection points.
- `src/main/agent/__tests__/roles-store.test.ts` — role library
  persistence, settings survival across role writes.
- `src/main/agent/__tests__/roles-tools.test.ts` — `chat_role_list` /
  `chat_role_save`.
- `src/main/agent/__tests__/external-driver.test.ts` — both stream
  parsers, tool-activity chip translation for both adapters, the external
  session-state store, prompt rendering, the claude-code adapter +
  segment orchestration (fake CLI, including the stale-resume retry and
  the Ask-mode approval gate), `resolveExternalCwd`'s chain, the Codex
  stream parser for both dialects and its argv building, and the handoff
  target policy.
- `src/main/agent/segment-execution.test.ts` — abort-after-reject
  normalization for external-role segments.
- `src/main/agent/chat-stop.test.ts` — the stop/abort helper functions in
  `chat-stop.ts`.
- `src/main/agent/chat-failure-persistence.test.ts` — `createFailedTurnToolTracker`
  and `failedAssistantMessage`.
- `src/renderer/src/components/chat/hooks/relayTurnHandlers.test.ts` —
  segment bubble open/freeze on `role-turn-start`/`role-turn-end`, the
  final-merge policy at `chat-complete`, and the mid-turn RelayBar
  handoff-growth case.
- `src/renderer/src/components/chat/hooks/roleMentionItems.test.ts` — the
  role-color TTL cache, recolor notifications, the external-only
  no-provider send guard, and the violet fallback on a failed library
  read.
