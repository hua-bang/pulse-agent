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

export const EXPERIMENTAL_FEATURES: ExperimentalFeatureDef[] = [
  {
    id: 'canvas-agent-debug-trace',
    label: 'Agent DevTools',
    description:
      'Adds a DevTools route that inspects per-run agent debug traces (chat history, tool calls, raw LLM payloads).',
    defaultEnabled: false,
  },
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
