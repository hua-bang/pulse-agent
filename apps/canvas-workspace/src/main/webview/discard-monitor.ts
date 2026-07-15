/**
 * L3 of the webview lifecycle ladder — Memory-Saver style discard.
 *
 * Every sweep, guest RSS for all registered url-webviews is summed from
 * `app.getAppMetrics()`. When the total exceeds the budget, frozen pages
 * (L2 — already minutes offscreen, past the audible/DevTools exemptions)
 * are discarded oldest-frozen-first until the projection is back under
 * budget (selection logic in ./discard-policy.ts). Discarding notifies the
 * renderer, which unmounts the `<webview>` (killing the guest process) and
 * shows the freeze-time snapshot as a sleeping placeholder; dwelling in the
 * viewport or clicking wakes the node, which reloads the freeze-time URL
 * and restores the scroll position — the same activate-to-restore contract
 * as Chrome's Memory Saver.
 *
 * Safety guard (freeze-first invariant): a page is frozen before it can be
 * discarded and a frozen page cannot acquire new dirty state, so the
 * freeze-time record (./freeze-probe.ts) is authoritative at sweep time.
 * Candidates whose record says dirty (unsaved in-page state) or
 * non-reloadable (blob:/populated about:blank) are never selected — their
 * RSS still counts toward the budget projection so other pages get
 * discarded instead. A frozen page with NO record is skipped too (fail
 * closed).
 *
 * Renderer-bound channel (main→renderer send; invisible to
 * describe-canvas's handle↔invoke parity, documented here per the
 * add-ipc-surface skill):
 *   'iframe:discarded'  { workspaceId, nodeId, snapshotDataUrl?,
 *                         restoreUrl?, scrollX, scrollY }
 *
 * Budget defaults to 1.5GB and can be overridden with
 * PULSE_CANVAS_WEBVIEW_MEMORY_BUDGET_MB. Snapshots come from the freeze-time
 * capture; the live-capture fallback is time-bounded (see ./snapshot.ts —
 * capturePage never settles on a hidden guest) and the renderer falls back
 * to a title/favicon card placeholder when there is no image.
 */
import { app, BrowserWindow } from 'electron';
import { getFrozenSince } from './lifecycle';
import { listRegisteredWebviews } from './registry';
import { selectWebviewsToDiscard, type DiscardCandidate } from './discard-policy';
import { captureBoundedSnapshot } from './snapshot';
import type { FreezeRecord } from './freeze-probe';

const DEFAULT_BUDGET_MB = 1_500;
const SWEEP_INTERVAL_MS = 30_000;

/**
 * Freeze-time records (snapshot + safety/restore state) captured by the
 * iframe:set-lifecycle handler, keyed by `${workspaceId}::${nodeId}`. Once
 * a page is frozen its element is hidden, paint stops, and scripts are
 * disabled, so nothing here could be re-captured at discard time — the
 * freeze-time record is remembered instead. Cleared on resume and consumed
 * on discard.
 */
const freezeRecords = new Map<string, FreezeRecord>();

export const rememberFreezeSnapshot = (key: string, record: FreezeRecord | undefined): void => {
  if (record) freezeRecords.set(key, record);
};

export const forgetFreezeSnapshot = (key: string): void => {
  freezeRecords.delete(key);
};

const readBudgetMB = (): number => {
  const raw = Number(process.env.PULSE_CANVAS_WEBVIEW_MEMORY_BUDGET_MB);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_BUDGET_MB;
};

/** Why a frozen candidate must not be discarded, or null when it may be. */
const discardBlockReason = (key: string): string | null => {
  const record = freezeRecords.get(key);
  if (record === undefined) return 'no freeze-time record (fail closed)';
  if (record.dirty) return 'dirty in-page state (unsaved input would be lost)';
  if (!record.reloadable) return `non-reloadable url (${record.url || 'unknown'})`;
  return null;
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

      // Freeze-record safety filter: blocked pages keep their RSS in the
      // projection (clearing frozenSinceMs makes the pure policy treat them
      // like active pages — counted but never selected).
      const blocked = new Map<string, string>();
      const guarded = priced.map((entry) => {
        if (entry.candidate.frozenSinceMs === undefined) return entry;
        const reason = discardBlockReason(entry.candidate.key);
        if (reason === null) return entry;
        blocked.set(entry.candidate.key, reason);
        return { ...entry, candidate: { ...entry.candidate, frozenSinceMs: undefined } };
      });

      const totalMB = guarded.reduce((sum, p) => sum + p.candidate.rssMB, 0);
      if (totalMB > budgetMB) {
        for (const [key, reason] of blocked) {
          console.log(`[webview-discard] skip ${key}: ${reason}`);
        }
      }

      const selected = new Set(
        selectWebviewsToDiscard(guarded.map((p) => p.candidate), budgetMB),
      );
      if (selected.size === 0) return;

      for (const { workspaceId, nodeId, wc, candidate } of guarded) {
        if (!selected.has(candidate.key) || wc.isDestroyed()) continue;
        const record = freezeRecords.get(candidate.key);
        // Prefer the freeze-time snapshot (a frozen page's element is hidden
        // and no longer paints); the live-capture fallback is time-bounded —
        // an unbounded capturePage on a hidden guest would never settle and
        // leave `sweeping` latched forever. Renderer falls back to a card
        // placeholder when both come up empty.
        let snapshotDataUrl = record?.imageDataUrl;
        if (!snapshotDataUrl) {
          snapshotDataUrl = await captureBoundedSnapshot(wc);
        }
        freezeRecords.delete(candidate.key);
        console.log(
          `[webview-discard] discarding ${candidate.key} (${Math.round(candidate.rssMB)}MB, ` +
          `frozen ${Math.round((Date.now() - (candidate.frozenSinceMs ?? Date.now())) / 1000)}s)`,
        );
        for (const win of BrowserWindow.getAllWindows()) {
          if (win.isDestroyed()) continue;
          win.webContents.send('iframe:discarded', {
            workspaceId,
            nodeId,
            snapshotDataUrl,
            restoreUrl: record?.url || undefined,
            scrollX: record?.scrollX ?? 0,
            scrollY: record?.scrollY ?? 0,
          });
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
