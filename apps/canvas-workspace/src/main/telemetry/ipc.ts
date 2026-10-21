/**
 * IPC and process-wide access for anonymous usage telemetry.
 *
 * Channels:
 *   telemetry:track        (event, props) → void; unknown events are dropped
 *   telemetry:status       ()             → TelemetryStatus
 *   telemetry:set-enabled  (enabled)      → TelemetryStatus
 *
 * Main code reports with `trackTelemetry`. The gateway URL comes from
 * `PULSE_CANVAS_TELEMETRY_URL`, else DEFAULT_TELEMETRY_URL in a packaged
 * build. With neither, the client is inert: it sends nothing and writes
 * nothing to disk.
 */

import { app, ipcMain } from 'electron';
import { homedir } from 'os';
import { join } from 'path';
import type { TelemetryEventName, TelemetryProps } from '../../shared/api/telemetry';
import { TelemetryClient } from './client';

// The deployed apps/telemetry-gateway URL.
const DEFAULT_TELEMETRY_URL = 'https://t.jasperhu.art/v1/events';

let client: TelemetryClient | undefined;

const isHttpUrl = (value: string): boolean => {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
};

function resolveEndpoint(): string {
  const override = process.env.PULSE_CANVAS_TELEMETRY_URL?.trim();
  if (override) return isHttpUrl(override) ? override : '';
  // Development launches stay silent unless the override is set.
  return app.isPackaged ? DEFAULT_TELEMETRY_URL : '';
}

function getTelemetryClient(): TelemetryClient {
  client ??= new TelemetryClient({
    endpoint: resolveEndpoint(),
    settingsPath: join(homedir(), '.pulse-coder', 'canvas', 'telemetry.json'),
    app: {
      version: app.getVersion(),
      platform: process.platform,
      arch: process.arch,
      packaged: app.isPackaged,
    },
  });
  return client;
}

/** Fire and forget. Telemetry never fails the caller. */
export function trackTelemetry<E extends TelemetryEventName>(event: E, props?: TelemetryProps<E>): void {
  try {
    void getTelemetryClient().track(event, props).catch(() => undefined);
  } catch {
    // No Electron app (unit tests) or no settings path: skip the event.
  }
}

export function shutdownTelemetry(): Promise<void> {
  return client ? client.shutdown() : Promise.resolve();
}

export function setupTelemetryIpc(): void {
  ipcMain.handle(
    'telemetry:track',
    (_event, payload: { event?: unknown; props?: unknown }) => {
      if (typeof payload?.event !== 'string') return;
      return getTelemetryClient().track(payload.event, payload.props);
    },
  );
  ipcMain.handle('telemetry:status', () => getTelemetryClient().status());
  ipcMain.handle(
    'telemetry:set-enabled',
    (_event, payload: { enabled?: unknown }) => (
      getTelemetryClient().setEnabled(payload?.enabled === true)
    ),
  );
}
