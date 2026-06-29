/**
 * Experimental feature registry.
 *
 * Add a new entry to {@link EXPERIMENTAL_FEATURES} to surface a toggle in
 * Settings → Experimental. The flag id is read by plugins via
 * `globalThis.canvasWorkspace.pluginFlags[id]` — so to gate a renderer
 * plugin behind a flag, set the plugin's `enabledWhen` to:
 *
 *     enabledWhen: () =>
 *       (globalThis as any).canvasWorkspace?.pluginFlags?.['my-flag-id'] === true,
 *
 * Persisted user overrides live at
 * `~/.pulse-coder/canvas/experimental-features.json` (override path with
 * `PULSE_CANVAS_EXPERIMENTAL_FEATURES`). Toggling a flag requires a
 * window reload to take effect — plugin activation snapshots the flag
 * values at renderer bootstrap.
 *
 * Shared between main / preload / renderer so the three sides agree on
 * defaults without an extra IPC round-trip.
 */

export interface ExperimentalFeatureDef {
  /** Stable id used by both the store and `pluginFlags`. Kebab-case. */
  id: string;
  /** Short label for the Settings UI. */
  label: string;
  /** One-sentence description for the Settings UI. */
  description: string;
  /** Value used when the user has not toggled this flag. */
  defaultEnabled: boolean;
}

/**
 * Pushed from main when a flag toggle kicks off a background tooling install
 * (for example the Agent Teams skill + CLI). Delivered over the
 * `experimental:tooling-status` channel once the install settles.
 */
export interface ToolingInstallStatus {
  /** The experimental flag id that triggered the install. */
  feature: string;
  ok: boolean;
  skillsInstalled: boolean;
  cliInstalled: boolean;
  cliError?: string | null;
  manualCommand?: string | null;
}

export const EXPERIMENTAL_FLAG_AGENT_DEBUG_TRACE = 'canvas-agent-debug-trace';
export const EXPERIMENTAL_FLAG_WORKSPACE_NODES = 'workspace-nodes-page';
export const EXPERIMENTAL_FLAG_WORKSPACE_GRAPH = 'workspace-graph-page';
export const EXPERIMENTAL_FLAG_WEBVIEW_PAGE_CONTROL = 'webview-page-control';
export const EXPERIMENTAL_FLAG_DYNAMIC_APP = 'dynamic-app';
export const EXPERIMENTAL_FLAG_CHANNELS = 'chat-channels';
export const EXPERIMENTAL_FLAG_AGENT_TEAMS = 'agent-teams';
export const EXPERIMENTAL_FLAG_PERF_PANEL = 'perf-panel';

// The Perf panel toggle only appears when the perf tooling is compiled in
// (dev builds / PULSE_PERF_TOOLS=1). The `typeof` guard keeps this safe in
// every context: production/dev builds replace __PERF_TOOLS__ with a literal
// (so this is `typeof false/true` → 'boolean'), while vitest and any context
// without the build-time define see an undeclared identifier — `typeof`
// returns 'undefined' rather than throwing, so the descriptor is simply
// omitted. Result: a packaged app shows no "Performance panel" toggle at all.
const PERF_PANEL_AVAILABLE =
  typeof __PERF_TOOLS__ !== 'undefined' && __PERF_TOOLS__ === true;

export const EXPERIMENTAL_FEATURES: ExperimentalFeatureDef[] = [
  {
    id: EXPERIMENTAL_FLAG_AGENT_DEBUG_TRACE,
    label: 'Agent DevTools',
    description:
      'Adds a DevTools route that inspects per-run agent debug traces (chat history, tool calls, raw LLM payloads).',
    defaultEnabled: false,
  },
  {
    id: EXPERIMENTAL_FLAG_WORKSPACE_NODES,
    label: 'Workspace Nodes page',
    description:
      'A workspace-wide knowledge library showing every node as a filterable grid, plus a per-node detail page. Surfaces a "Nodes" entry in the sidebar.',
    defaultEnabled: false,
  },
  {
    id: EXPERIMENTAL_FLAG_WORKSPACE_GRAPH,
    label: 'Workspace Graph page',
    description:
      'A force-directed graph view of all nodes in the workspace with grouped toolbar and suggest-search. Surfaces a "Graph" entry in the sidebar.',
    defaultEnabled: false,
  },
  {
    id: EXPERIMENTAL_FLAG_WEBVIEW_PAGE_CONTROL,
    label: 'Webview page control (agent)',
    description:
      'Lets the Canvas Agent control pages inside iframe nodes — click (by selector or pixel coordinates), fill, press keys, scroll, wait for selectors, run arbitrary JS. Clicks and key presses go through Chromium DevTools Protocol (real input events that fire pointer / hover / user-activation handlers) — the OS cursor does not move. Blocked on file://, chrome://, devtools:// and a built-in sensitive-domain list (banks, payments, mainstream login). Customize via ~/.pulse-coder/canvas/webview-action-policy.json. Treat this as giving an LLM access to whatever you are currently logged into.',
    defaultEnabled: false,
  },
  {
    id: EXPERIMENTAL_FLAG_DYNAMIC_APP,
    label: 'Dynamic apps (agent)',
    description:
      'Lets the Canvas Agent create live, server-backed iframe nodes — either polling apps (pull an external JSON endpoint on a schedule, optionally transform, render in LLM-authored HTML) or stateful apps (own their state, accept user mutations via POST actions, persist across restarts; todos / notes / counters / small forms). Each app gets its own loopback HTTP server in the Electron main process. LLM-authored transforms and action handlers run in a vm sandbox (no fetch / require / process; 1s sync timeout). State and spec files live under ~/.pulse-coder/canvas/<workspaceId>/dynamic-apps/. Off by default because this surfaces three new agent tools and a long-running HTTP server.',
    defaultEnabled: false,
  },
  {
    id: EXPERIMENTAL_FLAG_CHANNELS,
    label: 'Chat channels (Feishu)',
    description:
      'Drive a workspace’s Canvas Agent from an external chat channel. Feishu (Lark) is supported today via the SDK long-connection (works behind NAT, no public URL). Also requires FEISHU_APP_ID / FEISHU_APP_SECRET env vars set before launch; without them the channel stays inactive even when this flag is on. Inbound messages are bound to a workspace (default + switchable via /bind), the agent runs, and output streams back as an interactive card. Off by default because it opens an outbound connection to Feishu and lets a remote chat drive the agent.',
    defaultEnabled: false,
  },
  {
    id: EXPERIMENTAL_FLAG_AGENT_TEAMS,
    label: 'Agent Teams',
    description:
      'Shows the Agent Team canvas entry for experimental multi-agent planning and execution. Existing Agent Team frames can still be opened from saved canvases.',
    defaultEnabled: false,
  },
  ...(PERF_PANEL_AVAILABLE
    ? [
        {
          id: EXPERIMENTAL_FLAG_PERF_PANEL,
          label: 'Performance panel',
          description:
            'Adds a "Perf" route that surfaces live runtime metrics (FPS, JS heap, long tasks), per-process CPU/memory and guest webview counts, plus the latest CI bundle/bench snapshot (perf/out/perf-snapshot.json). A fully detachable observability plugin — off by default, zero cost when off.',
          defaultEnabled: false,
        },
      ]
    : []),
];

/**
 * Merge user overrides on top of registry defaults. Unknown override keys
 * are preserved (so a stale persisted entry from a removed feature does
 * not crash anything), but only registered flags show up in Settings.
 */
export function resolveFeatureValues(
  overrides: Record<string, boolean>,
): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  for (const def of EXPERIMENTAL_FEATURES) {
    out[def.id] = overrides[def.id] ?? def.defaultEnabled;
  }
  for (const [k, v] of Object.entries(overrides)) {
    if (!(k in out) && typeof v === 'boolean') out[k] = v;
  }
  return out;
}
