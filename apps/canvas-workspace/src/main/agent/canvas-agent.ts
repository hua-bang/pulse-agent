/**
 * Canvas Agent — the workspace-scoped AI Copilot.
 *
 * Uses pulse-coder-engine's Engine class to run an agentic loop with
 * canvas-specific tools + scope-appropriate engine tools: complete filesystem
 * access in workspace chat and an explicit-target capability boundary globally. Runs in Electron.
 */
import { Engine } from 'pulse-coder-engine';
import type { MCPAppsManager, MCPClientManager, MCPServerStatus } from 'pulse-coder-engine/built-in';
import type { ModelMessage } from 'ai';
import { join } from 'path';
import { resolveCanvasModel, type ResolvedCanvasModel } from '../models/config';
import { createCanvasEnginePlugins } from './engine-plugins';
import { formatSelectedPluginsBlock } from './plugin-selection-context';
import { agentBus } from '../../plugins/main';
import {
  buildWorkspaceSummary,
  formatSummaryForPrompt,
  resolveWorkspaceNames,
} from './context-builder';
import {
  createCanvasAgentToolPolicy,
  createCanvasAskModeToolPolicyPlugin,
} from './tool-policy';
import { GLOBAL_CHAT_WORKSPACE_NAME, SessionStore } from './session-store';
import { formatPromptProfileForSystem, getPromptProfile } from './prompt-profile';
import {
  formatWorkspaceContextSection,
  readWorkspaceDoc,
  readWorkspaceMeta,
  WORKSPACE_DOC_FILENAME,
} from './workspace-meta';
import { buildMemoryPromptSection } from './memory-store';
import { linkRunAbortSignal, persistStoppedBeforeSegment, resolveSegmentOutcome, settleStoppedToolCalls } from './chat-stop';
import {
  attachTraceModel,
  createCanvasAgentDebugTrace,
  finalizeCanvasAgentDebugTrace,
  isCanvasAgentDebugTraceEnabled, markTraceModelStarted, markTraceRuntimeCompleted,
  recordTraceMessageSnapshot, type CanvasAgentPerformanceTiming,
} from './debug-trace';
import type {
  AgentClarificationRequest,
  AgentScope,
  AgentRequestContext,
  CanvasAgentConfig,
  CanvasAgentImageAttachment,
  CanvasAgentMessage,
  CanvasAgentSession,
  WorkspaceSummary,
} from './types';
import { createFailedTurnToolTracker, failedAssistantMessage } from './chat-failure-persistence';
import { completeCanvasHostRun, markCanvasRuntimeCompleted, markCanvasRuntimeStarted } from './observability/host-run';
import { formatDomSelectionFocusBlock, type CanvasAgentDomSelection } from './dom-selection-context';
import { formatSelectionFocusBlock } from './selection-focus-context';
import { formatReferencedTabsBlock } from './referenced-tabs-context';
import {
  ROLE_RELAY_MAX_SEGMENTS,
  stripRoleMentionMarkers,
  type AgentRoleDefinition, type RoleTurnStartEvent, type RoleTurnEndEvent,
} from '../../shared/agent-roles';
import {
  applySpeakerLabelToResponseMessages,
  formatActiveRoleSection,
  formatRoleHistoryNote,
  handoffTargetRoles,
  replaceFinalAssistantText,
  resolveActiveRoles,
  resolveHandoffRoles,
  roleTurnRef,
  sanitizeRoleSegmentText,
  sessionMessageToModelMessage,
  shouldRunRelaySegment,
} from './role-turn';
import { getAgentRoleSettings, listAgentRoles } from './roles-store';
import {
  modelMessagesToToolCalls,
  type CanvasToolResultEvent,
} from './engine-stream-callbacks';
import { executeCanvasAgentSegment } from './segment-execution';
import { markCanvasHostContextReady, traceScopeActivationStep } from './observability/host-run';
import { traceEngineInitialize } from './observability/engine-init-trace';
import type { PendingClarificationRequest } from './clarification-registry';
import { CanvasRunRegistry } from './canvas-run-registry';
import { prepareRunSession } from './run-session-context';
import { executeMcpAppTool, resolveMcpApp } from './mcp-app-runtime';
type CanvasAgentRequestContext = AgentRequestContext & { domSelections?: CanvasAgentDomSelection[] };
const GLOBAL_AGENT_SYSTEM_PROMPT = `You are the Pulse Canvas AI Chat assistant.

This is a global chat, not bound to any specific canvas workspace.

## Your Role
You can answer questions, reason with the user, help draft text, explain code, and use the available research, file, image-generation, and shell tools when useful.
## Local Canvas Data — use the built-in tools, never an external server
Your Pulse Canvas data (workspaces, nodes, tags) lives locally and is read through these eager, cross-workspace tools. For ANY question about "my canvas / workspaces / nodes / tags" (我的画布 / 节点 / 标签), use these FIRST. Do NOT call a third-party MCP server (e.g. a separate mind/notes/knowledge server) to read local canvas data — those describe a different system and will give the wrong answer:
- \`knowledge_search_nodes\` — search the Nodes knowledge library by query, type, or tag without asking the user to choose a workspace. Use only when no exact node is already selected or mentioned.
- \`knowledge_read_node\` — read one exact selected, mentioned, or searched node without a workspace argument. This also reads knowledge records that are no longer placed on a canvas.
- \`knowledge_analyze_image\` — inspect pixels or OCR one exact image node, including images no longer placed on a canvas. Use this instead of taking a canvas screenshot.
- \`workspace_list\` — discover which workspaces exist (id, name, node + tag-coverage counts). Use this to obtain a workspaceId instead of asking the user blindly.
- \`knowledge_list_tags\` — every tag defined in the system (shared across all workspaces) with per-tag usage. This is the answer to "what tags do I have".
- \`knowledge_list_nodes\` — nodes across all workspaces (or one) with their tags; filter by \`tag\`, \`untaggedOnly\`, or \`query\`. Use it to audit tag coverage or find tagging candidates.

## Chat Session History (会话检索/总结)
Past chat sessions (every workspace + this global chat) are stored locally and searchable:
- \`session_search\` — keyword search over stored user/assistant messages; returns matching sessions with snippets. Use for "我们之前聊过 X 吗 / find the conversation about X".
- \`session_summary\` — compact transcript excerpts for one session (pass its sessionId) or every session in the last N days; read the excerpts and write the summary yourself. Use for "总结一下今天/这周的会话 / recap that conversation".
These read chat history, NOT canvas nodes — use the canvas tools above for nodes.
When you mention a found session in your reply, copy that result's \`ref\` marker (\`@[session:...|label]\`) verbatim into the sentence — it renders as a clickable link that jumps straight to that conversation.
When the USER's message contains \`@[session:<workspaceId>:<sessionId>:<msgIdx?>|<label>]\`, they are referencing that past chat session — call \`session_summary\` with that exact sessionId to read it before answering.

## Scope Rules
- Do not assume there is a current canvas or selected workspace. When you need one, call \`workspace_list\` to enumerate them and pick the right \`workspaceId\`; only ask the user when the choice is genuinely ambiguous.
- The remaining read-only canvas tools (\`canvas_read_context\`, \`canvas_read_layout\`, \`canvas_read_node\`, \`canvas_search_nodes\`, \`canvas_list_edges\`, \`workspace_node_list\`, \`workspace_node_get\`) need a concrete workspaceId on every call — get it from \`workspace_list\` or a workspace mention.
- Global chat can modify a target canvas when the user has clearly requested it: first resolve the exact workspaceId, then pass that workspaceId to every Canvas operation that reads or mutates it. Never guess or silently switch targets. Before calling any node-creating tool, present the proposed node and wait for explicit user confirmation in both Ask and Auto modes; the host approval card is the final gate, so do not call \`user_ask\` for a second confirmation. For other mutations, Ask mode waits for the normal approval and Auto mode acts only on clear user intent. Right-dock web tabs remain isolated per Workspace: interactive browser tools (\`dock_list_tabs\`, \`dock_activate_tab\`, \`dock_read_tab\`, \`browser_read_dom_selection\`, \`browser_read_page\`, \`page_*\`) may omit \`workspaceId\` for the visible Dock route, but must pass it to target another Workspace and never merge tab lists.
- Targeted Canvas writes include \`canvas_create_node\`, \`canvas_update_node\`, \`workspace_node_upsert\`, \`canvas_tag_node\`, and the deferred layout, edge, image, artifact, terminal, agent, and skill tools. If one is not in the initial list, search for it before calling it; every target-bound tool requires workspaceId. \`dock_open_tab\` is app-level UI in the current renderer's Dock and does not merge or move other Workspace sessions.
- Global chat CAN run shell commands with \`bash\` — use it whenever real data needs a local CLI (\`lark-cli\`, \`ntn\`, \`gh\`, …). Never claim shell is unavailable here or send the user to a workspace chat; that is no longer true. \`read\`/\`grep\`/\`ls\` inspect files, and \`write\`/\`edit\` can change explicitly named files. The shell is unsandboxed: prefer commands that read or fetch, and never run anything destructive on your own initiative.

## Guidelines
- Be concise and direct. When using tools, do not narrate internal search plans, source-ranking heuristics, or step-by-step progress as visible text. Use the tools first, then report only the result, uncertainty, and useful next action.
- Ask a clarifying question when the request depends on workspace-specific context you do not have.
`;
// ─── System prompt ─────────────────────────────────────────────────
const BASE_SYSTEM_PROMPT = `You are the Canvas Agent — the AI Copilot for this workspace.

## Your Role
You are the single AI entry point for this workspace. You can:
- Understand and explain everything on the canvas (files, terminals, agents, frames, images, mindmaps)
- Create, update, delete, and organize canvas nodes
- Read and write project files directly
- Run shell commands
- Generate documents, PRDs, and technical specs

## Context Strategy
Your system prompt contains a summary of all canvas nodes. For detailed content:
- Use \`canvas_read_node\` to read a specific node's full content
- Use \`canvas_read_context\` with detail="full" for everything at once
- For spatial/layout work, search for and call the layout tools (\`canvas_read_layout\`, then \`canvas_apply_layout\`); for single-node insertion prefer semantic \`placement\` (\`near_node\`, \`inside_frame\`, \`at\`) over raw x/y unless the user gave a precise location.

## Canvas Tools (always loaded)
- \`canvas_read_context\`: Read workspace overview or full context
- \`canvas_read_node\`: Read a single node's content in detail
- \`canvas_search_nodes\`: Search nodes by query / type / tag — use this BEFORE \`canvas_read_node\` when the canvas has many nodes so you don't blow the context window pulling the full summary
- \`canvas_create_node\`: Create new file/frame/text/image/iframe/mindmap nodes (generic)
- \`canvas_update_node\`: Update existing nodes (content, title, data)
- \`visual_render\`: Inline visual rendering (default for any visual request — see Visualization Tools below)
- \`artifact_create\`: Persistent, versioned visual artifact (only when the user explicitly asks to save / keep / iterate — see Visualization Tools below)
- \`user_ask\`: **Ask the user a clarifying question** — use this whenever the request is ambiguous, you need a choice between options, or you need confirmation before taking a destructive action. Prefer asking over guessing. Before any node-creating tool, show the user what will be added and wait for explicit confirmation in both Auto and Ask modes; the host enforces this immediately before execution, so do not duplicate it with a second \`user_ask\` call.

## Additional Tools (some deferred)
The following intent groups include tools that may be loaded directly or discoverable via \`tool_search_tool_bm25\` / \`tool_search_tool_regex\`. If a named tool is not already available, search for it before use. Grouped by intent:
- **Live data nodes**: \`dynamic_app_create\`, \`dynamic_app_list\`, \`dynamic_app_update\` — use when the user asks for live/polling/stateful canvas data widgets.
- **Node mutation (delete / move / resize)**: \`canvas_delete_node\`, \`canvas_move_node\`, \`canvas_resize_node\` — use when the user asks to remove, reposition, or resize a specific node.
- **Layout**: \`canvas_read_layout\`, \`canvas_apply_layout\` — use these whenever the user asks to organize, tidy, arrange, lay out, wrap nodes in a frame, or generate a structured canvas. Use \`region_grid\` for selected-node or rectangular-area cleanup. Creating one derived node should normally move only that new node; only reorganize existing nodes when the user asks to tidy/arrange/layout. Let the algorithm choose x/y instead of doing coordinate arithmetic in the prompt.
- **Specialized creators**: \`canvas_create_agent_node\` (create and optionally launch an AI agent node), \`canvas_create_terminal_node\` (preferred for terminal creation), \`canvas_create_shape\` (precise shape sizing).
- **Agent follow-ups**: \`canvas_send_to_agent\` — use whenever you need to interact with an ALREADY-running agent node (after the initial launch).
- **Image / vision**: \`image_analyze\` (read/OCR/analyze image nodes or local paths), \`image_generate\` (AI-generated image as a canvas image node), \`image_generate_from_mindmap\` (visual export of an existing mindmap node).
- **Edges / connections**: \`canvas_list_edges\`, \`canvas_create_edge\`, \`canvas_update_edge\`, \`canvas_delete_edge\` — use when the user asks to connect / link / draw arrows between nodes.
- **Group membership**: \`canvas_add_to_group\`, \`canvas_remove_from_group\` — use when the user asks to add/remove nodes to/from a group (groups own members via \`data.childIds\`; frames use spatial containment, no tool needed — just move into the frame's bbox).
- **Workspace-node knowledge layer**: \`workspace_node_list\`, \`workspace_node_get\`, \`workspace_node_upsert\`, \`canvas_tag_node\` — use when the user is tagging nodes, building a knowledge graph, or asking "find/group/connect nodes by X". Separate metadata store with tags / properties / typed links.
- **Artifact follow-ups**: \`artifact_update\` (only when iterating on an already-created artifact), \`artifact_pin_to_canvas\` (only after \`artifact_create\` — pins an existing artifact onto the canvas as an iframe node, used to lay out / compare side-by-side).
- **Chat session history (会话检索/总结)**: \`session_search\` (keyword search over past chat sessions — current + archived, every workspace + global chat), \`session_summary\` (compact transcript excerpts for one session or the last N days so you can write the summary). Use these when the user asks "我们之前聊过 X 吗 / 找一下上次关于 X 的对话 / 总结一下今天的会话"; they search chat history, not canvas nodes. When you mention a found session in your reply, copy that result's \`ref\` marker (\`@[session:...|label]\`) verbatim into the sentence — it renders as a clickable link that jumps straight to that conversation. When the USER's message contains \`@[session:<workspaceId>:<sessionId>:<msgIdx?>|<label>]\`, they are referencing that past chat session — call \`session_summary\` with that exact sessionId to read it before answering.
- **Webpage scraping**: \`browser_read_page\` (DOM / a11y / screenshot from an open iframe node).
- UI: \`page_*\` / \`host_renderer_eval\`.
- **Right-dock tabs**: \`dock_list_tabs\` discovers link, artifact, node-detail, canvas-preview, and terminal tabs; \`dock_activate_tab\` brings one to the front; \`dock_execute_terminal\` runs a command in an open Dock terminal. Continue to use the resource-specific tools for page, artifact, node, and canvas content changes.

**When to open a tab (strict) — \`dock_open_tab\`:** opening a tab is a **user-visible UI action** — it pops a new tab into the user's dock and spawns a live webview. Do NOT open a tab just to read or research a URL. To get content from a web page, use \`tavily_extract\` (fetch a specific URL) or \`tavily\` (search), and \`browser_read_page\` / \`dock_read_tab\` for pages already open on the canvas or dock. Only call \`dock_open_tab\` when the user **explicitly** asks to open / show / pull up a page in their dock, or when they want to interact with a live page (click / fill / navigate via \`page_*\`) that isn't open yet. When in doubt, fetch silently instead of opening a tab.

## Visualization Tools — visual_render is the DEFAULT

**Default to \`visual_render\` for ANY visual request.** It renders inline in the chat, streams live, and the user can promote it to an artifact themselves if they want to keep it. Don't reach for \`artifact_create\` just because the visual is large or polished — inline can handle dashboards, full pages, complex charts. Inline is the right home for *most* visual answers.

- \`visual_render\` (use for ~90% of visual requests): temporary inline visual rendered inside the current chat message. Pick this whenever the user asks for a chart, diagram, mockup, illustration, comparison view, flow, or "show me X" — basically anything visual that isn't *explicitly* a deliverable they're going to reuse later. The visual lives with the message; the user has a one-click "Save as artifact" button if they decide they want to keep it.
- \`artifact_create\`: **only use when the user EXPLICITLY signals they want a persistent artifact.** Trigger phrases: "save this as an artifact", "create an artifact for X", "I want to keep this", "let's iterate on this — make it an artifact", "build me a reusable component", "I'll edit this over time". If the user just says "make me a dashboard" or "build a landing page", that's still \`visual_render\` — they're asking to SEE it, not to manage it as a versioned object. When in doubt, prefer \`visual_render\` — the user can promote later, but they can't easily demote.
- \`artifact_pin_to_canvas\`: only after \`artifact_create\` — pins an existing artifact onto the spatial canvas as an iframe node. Use when the user wants to compare multiple options side-by-side or build a visual workspace. Always pin an artifact you already created; do NOT use \`canvas_create_node\` with mode=ai for this.

Decision rules (apply in order, stop at first match):
1. User mentioned "artifact" by name, or asked to save/keep/iterate/version a visual → \`artifact_create\`
2. User asked to lay out / pin / put on canvas / compare side-by-side → \`artifact_create\` followed by \`artifact_pin_to_canvas\`
3. **Everything else visual** → \`visual_render\` (including "build", "design", "make", "create", "draw", "show", "visualize", "chart", "diagram")

For HTML content in any of the three: emit a single self-contained \`<!DOCTYPE html>\` document. External CDNs (Chart.js, D3, Three.js, Mermaid) work fine. Inline all CSS in \`<head>\` and all scripts at the very end of \`<body>\` so it renders progressively.

Before writing HTML or SVG for \`visual_render\` or \`artifact_create\`, load the \`visual-style\` skill with the \`skill\` tool (once per conversation) and follow it: it picks the archetype (step, dashboard, schema, comparison, timeline, architecture, concept) and holds the density rules and shared CSS tokens. Mermaid output does not need it.

### Delegating Tasks to Agent Nodes
Search for and use \`canvas_create_agent_node\` to spawn another agent (Claude Code or Codex) with context.

**Workflow:**
1. Read relevant canvas nodes with \`canvas_read_node\` to gather context.
2. Compose a detailed \`prompt\` that includes the task description AND the relevant canvas content.
3. Search for and call \`canvas_create_agent_node\` — the host will request confirmation before adding the node, then the prompt is piped directly to the agent as its initial prompt.

Example:
\`\`\`json
{
  "title": "Codex: Implement Feature",
  "agentType": "codex",
  "cwd": "/path/to/project",
  "prompt": "## Task\\nImplement the login feature.\\n\\n## Context from Canvas\\n(PRD content here...)"
}
\`\`\`

### Following Up with a Running Agent Node
After an agent node is launched, use \`canvas_send_to_agent\` to send any additional prompts — follow-up questions, corrections, new tasks, approvals, etc. The text is written straight to the agent's PTY and Enter is auto-appended, so the agent receives and executes each call as one submission.

- Use \`canvas_read_node\` first if you need to see what the agent most recently output before deciding what to send.
- Do NOT use \`canvas_create_agent_node\` again just to say something more — that would spawn a second agent. Only create a new node when you want a fresh agent process.
- The target node must be \`type="agent"\`, \`status="running"\`, and still open on the canvas (closing the node tears down its PTY).

### Creating Terminal Nodes
Use \`canvas_create_terminal_node\` to spawn an interactive shell after the host approval card confirms the new node.
The shell starts automatically. Set \`cwd\` for the working directory.
Set \`command\` to auto-execute a command after the shell is ready (e.g. "npm run dev", "docker compose up").

## Filesystem Tools (built-in)
- \`read\`: Read file contents (with offset/limit support)
- \`write\`: Write or create files
- \`edit\`: Edit files with find & replace
- \`grep\`: Search file contents by regex
- \`ls\`: List directory contents
- \`bash\`: Execute shell commands

## Skills
- \`skill\`: Load a skill by name to get detailed step-by-step instructions for specialized tasks (e.g. canvas operations via pulse-canvas CLI, canvas-bootstrap for deep-research workspace creation)
- When the user's message contains a chip like \`@[skill:<name>]\`, treat it as an explicit request to load that skill — call the \`skill\` tool with that name BEFORE doing anything else, then follow the skill's step-by-step guidance.

Use these alongside canvas_* tools for full workspace control.

## Guidelines
- Be concise and direct. When using tools, do not narrate internal search plans, source-ranking heuristics, or step-by-step progress as visible text. Use the tools first, then report only the result, uncertainty, and useful next action.
- When creating file nodes, give them meaningful titles
- When the user references a node by title, look it up in the summary below
- For canvas-related tasks, use the canvas_* tools
- When asked to read an image, analyze an image node, OCR a screenshot, or create a mindmap from a picture, use \`image_analyze\` first.
- When asked to generate/draw/create a picture, use \`image_generate\`; when the source is a mindmap node, prefer \`image_generate_from_mindmap\`.
- When asked to save, write, pin, or add generated HTML / visual HTML / an HTML artifact to the canvas, create an \`iframe\` node in HTML mode. If you accidentally call \`canvas_create_node\` with \`type: "file"\` and full HTML content, the tool will route it to an iframe node automatically; use \`data.renderAs: "note"\` only when the user explicitly wants a markdown note.
- For code-related tasks, use the filesystem tools (read, write, edit, grep, bash)

`;

function formatMentionedCanvasesSection(
  mentionedCanvases: Array<{ id: string; name: string }> = [],
): string {
  if (mentionedCanvases.length === 0) return '';

  const lines: string[] = [
    '',
    '## Other Canvases Referenced by the User',
    'The user has `@`-mentioned the canvases listed below. This is a ' +
      '**reference table only** — it tells you which workspaceIds the user ' +
      'might be talking about. It is **not** an instruction to read them.',
    '',
    '**Strict rule — do NOT auto-read:** Do not call `canvas_read_context` ' +
      'or `canvas_read_node` for any canvas in this list unless the user\'s ' +
      'current message **explicitly asks** you to read, open, look at, ' +
      'summarize, compare, or otherwise use content from that specific ' +
      'canvas. A bare mention like "`@[canvas:Foo]` 怎么样？" where "怎么样" ' +
      'stands alone is **not** an explicit read request — ask the user what ' +
      'they want to know about it instead. Fetching without an explicit ' +
      'request wastes the user\'s tokens and is considered incorrect behavior.',
    '',
    'When the user **does** explicitly ask, use the matching `workspaceId` ' +
      'from the list with `canvas_read_context` (detail="summary" for the ' +
      'node list, detail="full" for file contents and terminal scrollback), ' +
      'or with `canvas_read_node` for a single node.',
    '',
    'Mentioned canvases:',
  ];
  for (const c of mentionedCanvases) {
    lines.push(`- **${c.name}** — workspaceId: \`${c.id}\``);
  }
  lines.push('');
  return lines.join('\n');
}

/**
 * Render the "Scoped Context" block for tags / whole canvases the user pinned
 * via the global assistant's @-picker. Members are fetched on demand by the
 * agent rather than dumped into the prompt (a tag can cover hundreds of nodes).
 */
function formatScopeContextBlock(
  tags: Array<{ name: string; workspaceIds?: string[] }> = [],
  canvases: Array<{ id: string; name: string }> = [],
): string {
  if (tags.length === 0 && canvases.length === 0) return '';
  const lines: string[] = ['', '## Scoped Context'];
  if (canvases.length > 0) {
    lines.push('', 'The user scoped this turn to these canvases — treat them as the primary workspaces to inspect:');
    for (const canvas of canvases) {
      lines.push(`- **${canvas.name}** — workspaceId: \`${canvas.id}\``);
    }
    lines.push('Use `canvas_search_nodes` / `canvas_read_node` with the matching workspaceId.');
  }
  if (tags.length > 0) {
    lines.push('', 'The user scoped this turn to these tags. To get their members, call `canvas_search_nodes({ tag: "<name>", workspaceId })` once per listed workspace — it filters by tag (names are resolved automatically) and returns a compact id/title/snippet list. Then `canvas_read_node` only the matches you actually need; do NOT dump every node with `workspace_node_list` and filter by hand:');
    for (const tag of tags) {
      const ws = tag.workspaceIds && tag.workspaceIds.length > 0
        ? ` — workspaceId(s): ${tag.workspaceIds.map((id) => `\`${id}\``).join(', ')}`
        : '';
      lines.push(`- tag \`${tag.name}\`${ws}`);
    }
  }
  return lines.join('\n') + '\n';
}

function buildSystemPrompt(
  summary: WorkspaceSummary | null,
  mentionedCanvases: Array<{ id: string; name: string }> = [],
  requestContext?: CanvasAgentRequestContext,
  promptProfileSection: string = '',
  workspaceDocSection: string = '',
): string {
  const selectedNodes = requestContext?.selectedNodes ?? [], domSelections = requestContext?.domSelections ?? [];
  // When the user has nodes selected, surface them BEFORE the full workspace
  // summary so the focused subset is the first thing the model anchors on.
  const selectionBlock = formatSelectionFocusBlock(selectedNodes, { requireWorkspaceId: false });
  const domSelectionBlock = formatDomSelectionFocusBlock(domSelections, { requireWorkspaceId: false });
  let base = summary
    ? BASE_SYSTEM_PROMPT + selectionBlock + domSelectionBlock + '\n## Current Canvas\n' + formatSummaryForPrompt(summary)
    : BASE_SYSTEM_PROMPT + selectionBlock + domSelectionBlock + '\n## Current Canvas\n(empty workspace — no nodes yet)\n';
  if (requestContext) {
    const mode = requestContext.executionMode ?? 'auto';
    const scope = requestContext.scope ?? 'current_canvas';
    const lines: string[] = [
      '',
      '## Current Request Context',
      `- Execution mode: ${mode}`,
      `- Context scope: ${scope}`,
    ];

    if (requestContext.quickAction) {
      lines.push(`- Suggested action the user invoked: ${requestContext.quickAction}`);
    }

    if (selectedNodes.length > 0) {
      lines.push(
        `- Selection: ${selectedNodes.length} node(s) — see "Current Focus" above for the authoritative list.`,
      );
    }

    if (domSelections.length > 0) {
      lines.push(
        `- DOM selection: ${domSelections.length} element(s) — see "Current Focus" above for selectors and text excerpts.`,
      );
    }

    if (mode === 'auto') {
      lines.push(
        'Auto mode policy: when the user intent is clear and non-destructive, you may directly use canvas tools to read context or update existing nodes. Before invoking any node-creating tool, present the proposed node and wait for explicit user confirmation; this gate applies in Auto mode too, and the host approval card is the only confirmation needed. Keep the visible response concise and avoid exposing raw node IDs, file paths, or tool signatures unless the user asks.',
      );
    } else {
      lines.push(
        'Ask mode policy: you may read context, but before creating, updating, deleting, or moving canvas nodes, or executing commands in a terminal, wait for the host approval card; do not call `user_ask` to duplicate that confirmation.',
      );
    }

    base += lines.join('\n') + '\n';
  }

  return base + formatMentionedCanvasesSection(mentionedCanvases) + workspaceDocSection + promptProfileSection;
}

// ─── Canvas Agent ──────────────────────────────────────────────────

/** Request payload emitted when the agent wants to ask the user a question. */
export type CanvasClarificationRequest = AgentClarificationRequest;

export class CanvasAgent {
  private engine: any; // Engine type from pulse-coder-engine (no .d.ts yet)
  private messages: ModelMessage[] = [];
  private sessionStore: SessionStore;
  private config: CanvasAgentConfig;
  /** Per-conversation run controls (see canvas-run-registry). */
  private runs = new CanvasRunRegistry();

  constructor(config: CanvasAgentConfig) {
    this.config = config;
    this.sessionStore = new SessionStore(config.sessionStoreId, config.scope);
    this.engine = this.buildEngine();
  }

  private get label(): string {
    return this.config.scope.kind === 'workspace'
      ? `workspace: ${this.config.scope.workspaceId}`
      : this.config.scope.kind === 'scheduled'
        ? `scheduled task: ${this.config.scope.taskId}`
        : 'global chat';
  }

  /**
   * Construct the Engine for this scope. The plugin list (and the scope-derived
   * skill / MCP / offload paths it needs) lives in `./engine-plugins`.
   * Called from the constructor and again on `reloadEngine()` so MCP config
   * edits take effect.
   */
  private buildEngine(): any {
    const toolPolicy = createCanvasAgentToolPolicy(this.config.scope);

    return new Engine({
      disableBuiltInPlugins: true,
      enginePlugins: {
        plugins: [
          ...createCanvasEnginePlugins(this.config.scope),
          createCanvasAskModeToolPolicyPlugin(),
        ] as never,
      },
      model: this.config.model,
      builtInTools: toolPolicy.builtInTools,
      tools: toolPolicy.canvasTools,
    });
  }

  async initialize(): Promise<void> {
    console.info(`[canvas-agent] Initializing for ${this.label}`);

    await traceEngineInitialize(this.engine);

    await traceScopeActivationStep('canvas.scope.session-restore', async () => {
      const restoredSession = await this.sessionStore.restoreLastSession();
      if (restoredSession) {
        this.messages = restoredSession.messages.map(sessionMessageToModelMessage);
      } else {
        await this.sessionStore.startSession();
        this.messages = [];
      }
    });

    console.info('[canvas-agent] Initialized');
  }

  /**
   * Re-scan skill files for this workspace (global + workspace scope).
   * Cheap and instant: the `skill` tool is regenerated per run from the
   * registry, so the next chat turn sees the refreshed list without an
   * Engine rebuild.
   */
  async rescanSkills(): Promise<void> {
    const registry = this.engine?.getService?.('skillRegistry') as
      | { rescan: () => Promise<void> }
      | undefined;
    if (registry?.rescan) {
      await registry.rescan();
    }
  }

  /**
   * Rebuild the Engine so MCP config changes take effect. MCP tools are
   * registered statically at init (no per-run injection), so we close the
   * old clients and re-initialize a fresh Engine. The conversation
   * (`this.messages`) and session store are preserved.
   */
  async reloadEngine(): Promise<void> {
    const manager = this.engine?.getService?.('mcp:__manager__') as
      | { closeAll: () => Promise<void> }
      | undefined;
    if (manager?.closeAll) {
      try {
        await manager.closeAll();
      } catch (err) {
        console.warn('[canvas-agent] Failed to close MCP clients on reload:', err);
      }
    }
    this.engine = this.buildEngine();
    await this.engine.initialize();
    console.info(`[canvas-agent] Engine reloaded for ${this.label}`);
  }

  getMcpStatuses(): Record<string, MCPServerStatus> {
    return this.getMcpManager()?.getStatuses() ?? {};
  }
  getMcpManager(): MCPClientManager | undefined {
    return this.engine?.getService?.('mcp:__manager__') as MCPClientManager | undefined;
  }
  getMcpAppsManager(): MCPAppsManager | undefined {
    return this.engine?.getService?.('mcp:__apps__') as MCPAppsManager | undefined;
  }
  async executeMcpAppTool(name: string, args: unknown, signal: AbortSignal): Promise<unknown> {
    const execution = await executeMcpAppTool(this.engine, name, args, signal);
    return this.getMcpAppsManager()?.getToolResult(execution.toolCallId) ?? execution.result;
  }
  /** Send a user message and get the agent's response. Streaming/text/tool
   * callbacks feed the renderer; `onClarificationRequest` asks the user a
   * question (answered later via `answerClarification` or cancelled via
   * `abort()`). The run anchors to `requestContext.expectedConversationSessionId`.
   */
  async chat(
    message: string,
    onText?: (delta: string) => void,
    onToolCall?: (data: { name: string; args: any; toolCallId?: string }) => void,
    onToolResult?: (data: CanvasToolResultEvent) => void,
    mentionedWorkspaceIds?: string[],
    onClarificationRequest?: (req: CanvasClarificationRequest) => void,
    requestContext?: CanvasAgentRequestContext,
    attachments: CanvasAgentImageAttachment[] = [],
    onToolInputStart?: (data: { id: string; toolName: string }) => void,
    onToolInputDelta?: (data: { id: string; delta: string }) => void,
    onToolInputEnd?: (data: { id: string }) => void,
    onRoleTurnStart?: (event: RoleTurnStartEvent) => void,
    onRoleTurnEnd?: (event: RoleTurnEndEvent) => void,
    runAbortSignal?: AbortSignal,
    modelConfigOverride?: ResolvedCanvasModel, performanceTiming?: CanvasAgentPerformanceTiming,
    persistMessages?: (sessionId: string, messages: CanvasAgentMessage[]) => void,
  ): Promise<{ response: string; runId?: string; stopped?: boolean; speakerRole?: { id: string; name: string; color: string }; sessionChanged?: { activeSessionId: string | null; error: string } }> {
    const workspaceId = this.config.scope.kind === 'workspace'
      ? this.config.scope.workspaceId
      : undefined;
    const summary = workspaceId ? await buildWorkspaceSummary(workspaceId) : null;

    // Anchor to the conversation the renderer showed; other conversations in
    // the same workspace stay free to run concurrently.
    const runContext = await prepareRunSession(
      this.sessionStore,
      requestContext?.expectedConversationSessionId,
      persistMessages,
    );
    if (!runContext.ok) {
      return {
        response: '',
        sessionChanged: {
          activeSessionId: runContext.activeSessionId,
          error: 'This conversation no longer exists. The latest thread was restored.',
        },
      };
    }
    const { targetSession, runMessages, runStoreMessages, appendRunMessages } = runContext;

    // For any other canvases the user @-mentioned, we only inject the
    // `{ id, name }` pair into the system prompt — the agent is expected to
    // call `canvas_read_context({ workspaceId })` on demand if it actually
    // needs that canvas's content.
    let mentionedCanvases: Array<{ id: string; name: string }> = [];
    if (mentionedWorkspaceIds && mentionedWorkspaceIds.length > 0) {
      const unique = Array.from(new Set(mentionedWorkspaceIds)).filter(
        id => id && id !== workspaceId,
      );
      mentionedCanvases = await resolveWorkspaceNames(unique);
    }

    let promptProfileSection = '';
    try {
      const profile = await getPromptProfile();
      promptProfileSection = formatPromptProfileForSystem(profile);
    } catch (err) {
      console.warn('[canvas-agent] Failed to load prompt profile, using defaults:', err);
    }

    let workspaceDocSection = '';
    let workspaceRootFolder: string | undefined;
    if (workspaceId) {
      try {
        const meta = await readWorkspaceMeta(workspaceId);
        workspaceRootFolder = meta.rootFolder;
        const workspaceDoc = await readWorkspaceDoc(meta.rootFolder);
        workspaceDocSection = formatWorkspaceContextSection(meta.rootFolder, workspaceDoc);
      } catch (err) {
        console.warn(`[canvas-agent] Failed to load workspace environment / ${WORKSPACE_DOC_FILENAME}:`, err);
      }
    }

    // Long-term memory (global + workspace entries); never throws.
    const memorySection = await buildMemoryPromptSection(workspaceId);

    // Multi-role chat: role markers pick speakers (none → default assistant;
    // several → RELAY segments against the shared history).
    const activeRoles = await resolveActiveRoles(message);
    const hasLabeledRoleHistory = activeRoles.length === 0
      && (targetSession.messages.some(m => !!m.speakerRoleName) ?? false);

    // Agent@agent handoff (opt-in): a role's reply may @-mention other roles
    // to append them to this turn's queue; external roles never speak unasked.
    let handoffLibrary: AgentRoleDefinition[] = [];
    if (activeRoles.length > 0) {
      try {
        if ((await getAgentRoleSettings()).allowRoleHandoff) {
          handoffLibrary = handoffTargetRoles(await listAgentRoles());
        }
      } catch (err) {
        console.warn('[canvas-agent] failed to read role-handoff settings, handoff off this turn:', err);
      }
    }
    // >0 (not >1): an external speaker may be filtered from the library.
    const handoffEnabled = handoffLibrary.length > 0;
    // Speaker labels the impersonation guard recognizes; other 【...】 is text.
    const knownRoleNames = new Set([...activeRoles, ...handoffLibrary].map(entry => entry.name));

    const currentCanvasSummary = summary ? formatSummaryForPrompt(summary) : undefined;
    const basePrompt = workspaceId
      ? buildSystemPrompt(summary, mentionedCanvases, requestContext, promptProfileSection, workspaceDocSection)
        + formatSelectedPluginsBlock(requestContext?.plugins ?? [])
        + formatReferencedTabsBlock(requestContext?.tabs ?? [], workspaceId)
        + memorySection
      : GLOBAL_AGENT_SYSTEM_PROMPT
        + formatSelectionFocusBlock(requestContext?.selectedNodes ?? [], { requireWorkspaceId: true })
        + formatDomSelectionFocusBlock(requestContext?.domSelections ?? [], { requireWorkspaceId: true })
        + formatScopeContextBlock(requestContext?.tags ?? [], requestContext?.canvases ?? [])
        + formatSelectedPluginsBlock(requestContext?.plugins ?? [])
        + formatReferencedTabsBlock(requestContext?.tabs ?? [])
        + formatMentionedCanvasesSection(mentionedCanvases)
        + memorySection
        + promptProfileSection;

    // Model-facing user text: role markers become plain `@name` (the store
    // keeps the raw marker for chips and regenerate/edit replays).
    const modelUserText = stripRoleMentionMarkers(message);
    const attachmentPrompt = attachments.length > 0
      ? [
          modelUserText,
          '',
          'User attached image files for this turn:',
          ...attachments.map((attachment, index) => {
            const name = attachment.fileName ? ` (${attachment.fileName})` : '';
            const mime = attachment.mimeType ? `, mime=${attachment.mimeType}` : '';
            return `${index + 1}. ${attachment.path}${name}${mime}`;
          }),
          workspaceId
            ? 'Use image_analyze with imagePaths when you need to inspect these images.'
            : 'Use the available filesystem/image-capable tools when you need to inspect these local image paths.',
        ].join('\n')
      : modelUserText;

    // Add user message: model sees local paths; history keeps structured attachments.
    runMessages.push({ role: 'user', content: attachmentPrompt } as ModelMessage);
    appendRunMessages([{
      role: 'user',
      content: message,
      timestamp: Date.now(),
      attachments: attachments.length > 0 ? attachments : undefined,
      contextSnapshot: requestContext?.contextSnapshot,
    }]);

    // Build the context — pass a mutable reference so onResponse/onCompacted can update it
    const context = { messages: runMessages };
    markCanvasHostContextReady(performanceTiming);

    // One AbortController per turn (hard stop); relayStop is the graceful boundary stop.
    const abortController = new AbortController();
    const runState = this.runs.start(targetSession.sessionId, abortController);
    const unlinkRunAbort = linkRunAbortSignal(runAbortSignal, abortController);

    // Wire the clarify tool through the run's per-session registry.
    const engineClarificationHandler = onClarificationRequest
      ? (req: PendingClarificationRequest) =>
          runState.clarifications.wait(req, onClarificationRequest, abortController.signal)
      : undefined;
    const failedTurnTools = createFailedTurnToolTracker({
      onText, onToolCall, onToolResult, onToolInputStart, onToolInputDelta, onToolInputEnd,
    });

    const segments: Array<AgentRoleDefinition | null> = activeRoles.length > 0 ? activeRoles : [null];
    const queue = segments.map(roleTurnRef);
    let last: { response: string; runId?: string; role: AgentRoleDefinition | null; stopped?: boolean } | null = null;
    let observabilityCursor = performanceTiming?.contextReadyAt ?? Date.now();
    const finishStoppedBeforeSegment = () => persistStoppedBeforeSegment({
      addMessage: (message) => appendRunMessages([message]),
    });

    try {
      if (abortController.signal.aborted) return finishStoppedBeforeSegment();
      const modelConfig = modelConfigOverride ?? await resolveCanvasModel();
      for (let index = 0; index < segments.length; index++) {
        if (!shouldRunRelaySegment(index, { aborted: abortController.signal.aborted, stopRequested: runState.relayStop.stopped })) {
          if (abortController.signal.aborted) return finishStoppedBeforeSegment();
          break;
        }
        const role = segments[index];
        const segmentPrompt = basePrompt + (role
          ? formatActiveRoleSection(
              role,
              { index, total: segments.length },
              handoffEnabled ? { otherNames: handoffLibrary.map(entry => entry.name) } : undefined,
            )
          : hasLabeledRoleHistory ? formatRoleHistoryNote() : '');
        // External segments produce no engine trace (no model config of ours).
        const debugTrace = !role?.external && isCanvasAgentDebugTraceEnabled()
          ? createCanvasAgentDebugTrace({
              runId: index === 0 ? performanceTiming?.runId : undefined,
              sessionId: targetSession.sessionId,
              userPrompt: message,
              attachmentCount: attachments.length,
              requestContext,
              mentionedCanvases,
              summary,
              systemPrompt: segmentPrompt,
              currentCanvasSummary,
              performance: performanceTiming,
            })
          : undefined;
        attachTraceModel(debugTrace, {
          provider: modelConfig.providerType,
          model: this.config.model ?? modelConfig.model,
          modelType: modelConfig.modelType,
        });
        failedTurnTools.reset();
        onRoleTurnStart?.({ index, total: segments.length, speakerRole: roleTurnRef(role), queue });
        const runtimeStartedAt = markCanvasRuntimeStarted(performanceTiming, observabilityCursor);
        markTraceModelStarted(debugTrace);

        const { responseMessages, externalToolCalls, resultText, runtimeOwner, streamedText } = await executeCanvasAgentSegment({
          engine: this.engine,
          context,
          role,
          chatSessionId: targetSession.sessionId,
          workspaceRootFolder,
          history: runStoreMessages,
          currentAsk: modelUserText,
          handoffNames: handoffEnabled ? handoffLibrary.map(entry => entry.name) : [],
          abortSignal: abortController.signal,
          executionMode: requestContext?.executionMode ?? 'auto',
          onClarificationRequest: engineClarificationHandler,
          ...failedTurnTools.callbacks,
          modelConfig,
          configuredModel: this.config.model,
          systemPrompt: segmentPrompt,
          observabilityRunId: performanceTiming?.runId, observeFirstActivity: index === 0,
          debugTrace,
          appendMessages: messages => runMessages.push(...messages),
          replaceMessages: messages => {
            runMessages.splice(0, runMessages.length, ...messages);
          },
        });
        observabilityCursor = markCanvasRuntimeCompleted(performanceTiming, runtimeStartedAt, runtimeOwner);
        markTraceRuntimeCompleted(debugTrace);

        const toolCalls = externalToolCalls ?? modelMessagesToToolCalls(responseMessages, (name, id) => resolveMcpApp(this.getMcpAppsManager(), name, id));

        // Impersonation guard runs before persist/label/handoff.
        const { stopped, rawText } = resolveSegmentOutcome({
          signalAborted: abortController.signal.aborted,
          resultText,
          streamedText, hasToolOutput: toolCalls.length > 0,
        });
        const responseText = role
          ? sanitizeRoleSegmentText(rawText, role.name, knownRoleNames) || (stopped || toolCalls.length > 0 ? '' : '(no response)')
          : rawText;
        recordTraceMessageSnapshot(debugTrace, { systemPrompt: segmentPrompt, messages: context.messages });

        if (stopped) {
          settleStoppedToolCalls(toolCalls, failedTurnTools.snapshot());
          // Engine returns a sentinel on abort; preserve the exact text the
          // renderer saw instead of ever inserting the sentinel.
          if (responseText && !responseMessages.some(messageEntry => (
            messageEntry.role === 'assistant'
            && messageEntry.content === responseText
          ))) {
            const partialMessage = { role: 'assistant', content: responseText } as ModelMessage;
            runMessages.push(partialMessage);
            responseMessages.push(partialMessage);
          }
        }
        // Live-push speaker label — MUST mirror `sessionMessageToModelMessage`;
        // it is what lets segment N+1 read segment N's reply with attribution.
        if (role) {
          // Trimmed? sync the live history or the next speaker reads the cut part.
          if (responseText !== rawText) replaceFinalAssistantText(responseMessages, responseText);
          applySpeakerLabelToResponseMessages(responseMessages, role.name);
        }
        const finalizedTrace = finalizeCanvasAgentDebugTrace(debugTrace, stopped ? 'stopped' : 'success');
        appendRunMessages([{
          role: 'assistant',
          ...failedTurnTools.finalize(responseText, toolCalls, responseText !== rawText),
          timestamp: Date.now(),
          runId: finalizedTrace?.runId,
          speakerRoleId: role?.id,
          speakerRoleName: role?.name,
          speakerRoleColor: role?.color,
          turnStatus: stopped ? 'stopped' : undefined,
          retryable: stopped ? true : undefined,
        }]);

        // Notify plugins (devtools persists the trace); awaited so storage flushes first.
        if (finalizedTrace) {
          await agentBus.emitTurnAsync('turnEnd', {
            runId: finalizedTrace.runId,
            sessionId: finalizedTrace.sessionId,
            data: {
              trace: finalizedTrace,
              assistantPreview: responseText.slice(0, 180),
              workspaceId: workspaceId ?? 'global',
              workspaceName: summary?.workspaceName ?? GLOBAL_CHAT_WORKSPACE_NAME,
            },
          });
        }

        // Agent@agent: scan reply for @Name handoffs, grow the queue before
        // the end event; frozen once a stop is pending.
        if (handoffEnabled && role && !runState.relayStop.stopped && !stopped) {
          const handoffs = resolveHandoffRoles(responseText, {
            speaker: role,
            libraryRoles: handoffLibrary,
            pendingIds: segments.slice(index + 1).flatMap(entry => (entry ? [entry.id] : [])),
            capacity: ROLE_RELAY_MAX_SEGMENTS - segments.length,
          });
          for (const handoffRole of handoffs) {
            segments.push(handoffRole);
            queue.push({ ...roleTurnRef(handoffRole)!, namedBy: role.name });
          }
        }

        last = {
          response: responseText,
          runId: finalizedTrace?.runId,
          role,
          stopped,
        };
        if (stopped) break;
        onRoleTurnEnd?.({
          index,
          total: segments.length,
          response: responseText,
          runId: finalizedTrace?.runId,
          speakerRole: roleTurnRef(role),
        });
      }

      completeCanvasHostRun(performanceTiming, observabilityCursor, last?.stopped ? 'stopped' : 'success');

      return {
        response: last?.response ?? '(no response)',
        runId: last?.runId,
        stopped: last?.stopped,
        speakerRole: roleTurnRef(last?.role ?? null) ?? undefined,
      };
    } catch (error) {
      appendRunMessages([failedAssistantMessage(error, failedTurnTools.snapshot(), failedTurnTools.contentBlocks())]);
      throw error;
    } finally {
      unlinkRunAbort();
      this.runs.stop(targetSession.sessionId, runState);
    }
  }

  /**
   * Abort the chat turn anchored to `sessionId`, or the most recent turn when
   * no session is given (legacy scope-level controls). Safe to call when no
   * turn is active — it becomes a no-op.
   */
  abort(sessionId?: string): void {
    this.runs.abort(sessionId);
  }

  /**
   * Graceful relay stop: the segment currently speaking finishes normally,
   * queued segments are skipped (see `shouldRunRelaySegment`). Returns false
   * when no turn is running.
   */
  stopRelay(sessionId?: string): boolean {
    return this.runs.stopRelay(sessionId);
  }

  /**
   * Deliver a user's answer to a pending clarification request. Returns
   * true if the answer matched a pending request, false otherwise.
   */
  answerClarification(requestId: string, answer: string): boolean {
    return this.runs.answerClarification(requestId, answer);
  }

  getPendingClarification(sessionId?: string): CanvasClarificationRequest | null {
    return this.runs.getPendingClarification(sessionId);
  }

  /**
   * Get conversation history for the current session.
   */
  getHistory(): CanvasAgentMessage[] {
    return this.sessionStore.getMessages();
  }

  /**
   * Get the current session ID.
   */
  getCurrentSessionId(): string | null {
    return this.sessionStore.getCurrentSession()?.sessionId ?? null;
  }

  readSessionById(sessionId: string, refreshIfClean = false): Promise<CanvasAgentSession | null> { return this.sessionStore.readSession(sessionId, refreshIfClean); }

  /**
   * Get the message count for the current session.
   */
  getMessageCount(): number {
    return this.sessionStore.getMessages().length;
  }

  /**
   * List all skills the engine has loaded — name + description only.
   * Used by the ChatPanel `/`-trigger popup; the full skill body is fetched
   * via the `skill` tool when the agent actually runs.
   */
  listSkills(): Array<{ name: string; description: string }> {
    const registry = this.engine?.getService?.('skillRegistry') as
      | { getAll: () => Array<{ name: string; description: string }> }
      | undefined;
    if (!registry) return [];
    return registry.getAll().map(s => ({ name: s.name, description: s.description }));
  }

  /**
   * List all sessions (current + archived).
   */
  async listSessions() {
    return this.sessionStore.listSessions();
  }

  /**
   * Start a new session (archives current if any).
   */
  async newSession(): Promise<void> {
    await this.sessionStore.startSession();
    this.messages = [];
  }

  async branchSession(
    fromIndex: number,
  ): Promise<{ sourceSessionId: string; session: CanvasAgentSession } | null> {
    const branch = await this.sessionStore.branchSession(fromIndex);
    if (!branch) return null;
    this.messages = branch.session.messages.map(sessionMessageToModelMessage);
    return branch;
  }

  renameSession(sessionId: string, title: string): Promise<boolean> {
    return this.sessionStore.renameSession(sessionId, title);
  }

  setSessionPinned(sessionId: string, pinned: boolean): Promise<boolean> {
    return this.sessionStore.setSessionPinned(sessionId, pinned);
  }

  async deleteSession(sessionId: string) {
    const deleted = await this.sessionStore.deleteSession(sessionId);
    if (!deleted) return null;
    this.messages = deleted.activeSession.messages.map(sessionMessageToModelMessage);
    return deleted;
  }

  /**
   * Load a specific archived session by sessionId.
   */
  async loadSession(sessionId: string): Promise<CanvasAgentSession | null> {
    const session = await this.sessionStore.loadSession(sessionId);
    if (!session) return null;
    // Restore text and bounded historical tool evidence. Provider-specific
    // tool frames are not replayed; follow-ups still receive the saved results.
    this.messages = session.messages.map(sessionMessageToModelMessage);
    return session;
  }

  /**
   * Load messages from a cross-workspace session as the current view.
   * Archives current session first, then sets the loaded messages.
   */
  async loadCrossWorkspaceSession(loadedMessages: CanvasAgentMessage[]): Promise<void> {
    await this.sessionStore.startSession();
    this.messages = loadedMessages.map(sessionMessageToModelMessage);
    // Batch-assign + persist once (setMessages), not one addMessage() call
    // per loaded message — the latter fires one full-session-rewrite
    // persist() per message, growing O(N) writes for N loaded messages.
    this.sessionStore.setMessages(loadedMessages);
  }

  /**
   * Drop messages at and after `fromIndex` from both the in-memory
   * LLM context and the persisted session. Used by edit / regenerate
   * flows in the chat panel.
   */
  rewindTo(fromIndex: number): void {
    if (fromIndex < 0) return;
    if (fromIndex < this.messages.length) {
      this.messages.length = fromIndex;
    }
    this.sessionStore.truncateMessages(fromIndex);
  }

  /** Session-addressed append, serialized by the coordinator's scope tail. */
  async appendToSession(
    sessionId: string,
    messages: CanvasAgentMessage[],
  ): Promise<void> {
    await this.sessionStore.appendToSession(sessionId, messages);
  }

  async replaceSessionMessagesById(sessionId: string, messages: CanvasAgentMessage[]): Promise<void> {
    await this.sessionStore.replaceMessagesInSession(sessionId, messages);
  }

  /**
   * Destroy the agent (called when workspace is closed).
   */
  async destroy(): Promise<void> {
    console.info(`[canvas-agent] Destroying for ${this.label}`);
    this.runs.abortAll();
    const manager = this.engine?.getService?.('mcp:__manager__') as
      | { closeAll: () => Promise<void> }
      | undefined;
    if (manager?.closeAll) {
      try {
        await manager.closeAll();
      } catch (err) {
        console.warn('[canvas-agent] Failed to close MCP clients on destroy:', err);
      }
    }
    await this.sessionStore.archiveSession();
    this.messages = [];
  }
}
