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
 *  - `memory-report:cancel` — abort the in-flight run (no-op when idle).
 *  - `memory-report:progress` (push, main → every window) — coarse phase of
 *    the in-flight run ({ phase: 'reading' | 'writing', toolCalls? });
 *    drives the settings toast. Pushes are invisible to describe-canvas
 *    parity — this comment is their registry.
 *
 * Single-flight: concurrent invocations share the in-flight run's promise.
 * The implementation modules load lazily on first use so this registration
 * keeps the main entry bundle lean.
 */

import { BrowserWindow, ipcMain } from 'electron';
import type { MemoryReportProgress, MemoryReportRunResult } from '../../shared/memory-report';

function broadcastProgress(progress: MemoryReportProgress): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (win.isDestroyed()) continue;
    win.webContents.send('memory-report:progress', progress);
  }
}

let inFlight: Promise<MemoryReportRunResult> | null = null;
let currentAbort: AbortController | null = null;

async function runNow(): Promise<MemoryReportRunResult> {
  const [{ runScheduledMemoryReport, GLOBAL_ARTIFACT_SCOPE_ID }, { openDockArtifact }] =
    await Promise.all([import('./memory-report'), import('../dock/tab-actions')]);

  const controller = new AbortController();
  currentAbort = controller;
  try {
    const result = await runScheduledMemoryReport({
      onPhase: (progress) => broadcastProgress(progress),
      abortSignal: controller.signal,
    });
    if (!result.ok) {
      return { ok: false, error: result.error, cancelled: result.cancelled };
    }
    if (result.artifactId) {
      openDockArtifact(GLOBAL_ARTIFACT_SCOPE_ID, result.artifactId);
    }
    return { ok: true, artifactId: result.artifactId, path: result.path };
  } finally {
    if (currentAbort === controller) currentAbort = null;
  }
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

  ipcMain.handle('memory-report:cancel', async (): Promise<{ ok: boolean }> => {
    currentAbort?.abort();
    return { ok: true };
  });
}
