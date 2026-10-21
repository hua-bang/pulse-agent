/**
 * Anonymous usage telemetry contract.
 *
 * Main owns the queue, the anonymous device id, and the user setting.
 * Renderer code reports through `window.canvasWorkspace.telemetry.track`.
 * Main sends batches to the Pulse telemetry gateway
 * (`apps/telemetry-gateway`), never to an analytics vendor directly, so the
 * vendor can change without a client release.
 *
 * TELEMETRY_EVENTS is the complete list of events the app can send, with
 * the prop keys each one may carry. Add an event or key here first; main
 * drops any other name or key. Props carry only counts, kinds, and flags:
 * never conversation text, file paths, URLs, or titles.
 *
 * `node_created` counts nodes a user adds (toolbar, menu, drop), not
 * duplicates, pastes, or group frames. Agent-created nodes are counted in
 * `agent_turn_finished.nodes_created`.
 *
 * One agent turn is one sent message until its reply ends. Every
 * `agent_turn_started` has one `agent_turn_finished`; `trigger` tells a
 * user message from a scheduled run.
 */

export const TELEMETRY_EVENTS = {
  app_started: ['first_launch'],
  page_viewed: ['page'],
  model_configured: ['action', 'provider_type', 'api_key_present'],
  workspace_created: ['source'],
  agent_turn_started: ['scope', 'trigger', 'execution_mode', 'has_attachments', 'context_count'],
  agent_turn_finished: [
    'scope',
    'trigger',
    'outcome',
    'error_kind',
    'duration_ms',
    'tool_calls',
    'nodes_created',
  ],
  node_created: ['type'],
} as const satisfies Record<string, readonly string[]>;

export type TelemetryEventName = keyof typeof TELEMETRY_EVENTS;

export type TelemetryPropValue = string | number | boolean;

/** Only the prop keys listed for the event; main drops any other key. */
export type TelemetryProps<E extends TelemetryEventName = TelemetryEventName> = Partial<
  Record<(typeof TELEMETRY_EVENTS)[E][number], TelemetryPropValue>
>;

export interface TelemetryStatus {
  /** False when this build has no gateway URL; nothing is ever sent. */
  configured: boolean;
  /** The user setting. Defaults to true until the user turns it off. */
  enabled: boolean;
}

export interface TelemetryApi {
  track: <E extends TelemetryEventName>(event: E, props?: TelemetryProps<E>) => Promise<void>;
  status: () => Promise<TelemetryStatus>;
  setEnabled: (enabled: boolean) => Promise<TelemetryStatus>;
}
