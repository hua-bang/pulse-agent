/**
 * L3 of the webview lifecycle ladder — Memory-Saver style discard.
 *
 * Every sweep, guest RSS for all registered url-webviews is summed from
 * `app.getAppMetrics()`. When the total exceeds the budget, frozen pages
 * (L2 — already minutes offscreen, past the audible/DevTools exemptions)
 * are discarded oldest-frozen-first until the projection is back under
 * budget (selection logic in ./discard-policy.ts). Discarding captures a
 * last-frame snapshot, then notifies the renderer, which unmounts the
 * `<webview>` (killing the guest process) and shows the snapshot as a
 * sleeping placeholder; dwelling in the viewport or clicking wakes the
 * node, which reloads the page — the same activate-to-restore contract as
 * Chrome's Memory Saver.
 *
 * Renderer-bound channel (main→renderer send; invisible to
 * describe-canvas's handle↔invoke parity, documented here per the
 * add-ipc-surface skill):
 *   'iframe:discarded'  { workspaceId, nodeId, snapshotDataUrl? }
 *
 * Budget defaults to 1.5GB and can be overridden with
 * PULSE_CANVAS_WEBVIEW_MEMORY_BUDGET_MB. capturePage on a frozen surface
 * returns the last painted frame; if it fails or comes back empty the
 * renderer falls back to a title/favicon card placeholder.
 */
import { app, BrowserWindow } from 'electron';
import { getFrozenSince } from './lifecycle';
import { listRegisteredWebviews } from './registry';
import { selectWebviewsToDiscard, type DiscardCandidate } from './discard-policy';

const DEFAULT_BUDGET_MB = 1_500;
const SWEEP_INTERVAL_MS = 30_000;
const SNAPSHOT_MAX_WIDTH = 800;

const readBudgetMB = (): number => {
  const raw = Number(process.env.PULSE_CANVAS_WEBVIEW_MEMORY_BUDGET_MB);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_BUDGET_MB;
};

export function startWebviewDiscardMonitor(): () => void {
  const budgetMB = readBudgetMB();
  let sweeping = false;

  const sweep = async (): Promise<void> => {
    if (sweeping) return;
    sweeping = true;
    try {
      const entries = listRegisteredWebviews();
      if (entries.length === 0) return;

      const rssByPid = new Map<number, number>();
      for (const metric of app.getAppMetrics()) {
        rssByPid.set(metric.pid, (metric.memory?.workingSetSize ?? 0) / 1024);
      }

      const priced = entries.flatMap((entry) => {
        let pid: number;
        try {
          pid = entry.wc.getOSProcessId();
        } catch {
          return [];
        }
        const candidate: DiscardCandidate = {
          key: `${entry.workspaceId}::${entry.nodeId}`,
          rssMB: rssByPid.get(pid) ?? 0,
          frozenSinceMs: getFrozenSince(entry.wc),
        };
        return [{ ...entry, candidate }];
      });

      const selected = new Set(
        selectWebviewsToDiscard(priced.map((p) => p.candidate), budgetMB),
      );
      if (selected.size === 0) return;

      for (const { workspaceId, nodeId, wc, candidate } of priced) {
        if (!selected.has(candidate.key) || wc.isDestroyed()) continue;
        let snapshotDataUrl: string | undefined;
        try {
          const image = await wc.capturePage();
          if (!image.isEmpty()) {
            const { width } = image.getSize();
            const bounded = width > SNAPSHOT_MAX_WIDTH
              ? image.resize({ width: SNAPSHOT_MAX_WIDTH })
              : image;
            snapshotDataUrl = bounded.toDataURL();
          }
        } catch {
          // Snapshot is best-effort — renderer falls back to a card.
        }
        console.log(
          `[webview-discard] discarding ${candidate.key} (${Math.round(candidate.rssMB)}MB, ` +
          `frozen ${Math.round((Date.now() - (candidate.frozenSinceMs ?? Date.now())) / 1000)}s)`,
        );
        for (const win of BrowserWindow.getAllWindows()) {
          if (win.isDestroyed()) continue;
          win.webContents.send('iframe:discarded', { workspaceId, nodeId, snapshotDataUrl });
        }
      }
    } finally {
      sweeping = false;
    }
  };

  const timer = setInterval(() => {
    void sweep();
  }, SWEEP_INTERVAL_MS);
  return () => clearInterval(timer);
}
