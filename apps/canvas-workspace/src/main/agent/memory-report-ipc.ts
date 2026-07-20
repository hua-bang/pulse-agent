/**
 * IPC for on-demand memory-report generation.
 *
 * Channels:
 *  - `memory-report:run-now` — generate a report immediately and open it in
 *    the dock. User-initiated, so deliberately NOT gated by the
 *    scheduled-memory-report experimental flag (the flag gates AUTOMATIC
 *    background spend; a click is explicit consent to one LLM run). This is
 *    the settings "try it" button behind the flag toggle — registered
 *    unconditionally so the button works right after enabling the flag,
 *    before the restart that arms the scheduler.
 *
 * Single-flight: concurrent invocations share the in-flight run's promise.
 * The implementation modules load lazily on first use so this registration
 * keeps the main entry bundle lean.
 */

import { ipcMain } from 'electron';
import type { MemoryReportRunResult } from '../../shared/memory-report';

let inFlight: Promise<MemoryReportRunResult> | null = null;

async function runNow(): Promise<MemoryReportRunResult> {
  const [{ runScheduledMemoryReport, GLOBAL_ARTIFACT_SCOPE_ID }, { openDockArtifact }] =
    await Promise.all([import('./memory-report'), import('../dock/tab-actions')]);

  const result = await runScheduledMemoryReport();
  if (!result.ok) {
    return { ok: false, error: result.error };
  }
  if (result.artifactId) {
    openDockArtifact(GLOBAL_ARTIFACT_SCOPE_ID, result.artifactId);
  }
  return { ok: true, artifactId: result.artifactId, path: result.path };
}

export function setupMemoryReportIpc(): void {
  ipcMain.handle('memory-report:run-now', async (): Promise<MemoryReportRunResult> => {
    if (!inFlight) {
      inFlight = runNow()
        .catch((err) => ({ ok: false, error: err instanceof Error ? err.message : String(err) }))
        .finally(() => {
          inFlight = null;
        });
    }
    return inFlight;
  });
}
