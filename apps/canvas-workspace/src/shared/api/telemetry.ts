/**
 * Anonymous usage telemetry contract.
 *
 * Main owns the queue, the anonymous device id, and the user setting.
 * Renderer code reports through `window.canvasWorkspace.telemetry.track`.
 * Main sends batches to the Pulse telemetry gateway
 * (`apps/telemetry-gateway`), never to an analytics vendor directly, so the
 * vendor can change without a client release.
 *
 * TELEMETRY_EVENTS is the complete list of events the app can send. Add an
 * event here first; main drops any other name. Props carry only counts,
 * kinds, and flags: never conversation text, file paths, URLs, or titles.
 */

export const TELEMETRY_EVENTS = [
  'app_started',
  'agent_turn_started',
  'node_created',
] as const;

export type TelemetryEventName = typeof TELEMETRY_EVENTS[number];

export type TelemetryPropValue = string | number | boolean;

export type TelemetryProps = Record<string, TelemetryPropValue>;

export interface TelemetryStatus {
  /** False when this build has no gateway URL; nothing is ever sent. */
  configured: boolean;
  /** The user setting. Defaults to true until the user turns it off. */
  enabled: boolean;
}

export interface TelemetryApi {
  track: (event: TelemetryEventName, props?: TelemetryProps) => Promise<void>;
  status: () => Promise<TelemetryStatus>;
  setEnabled: (enabled: boolean) => Promise<TelemetryStatus>;
}
