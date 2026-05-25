import { useEffect, useRef, useState } from 'react';
import { useAppShell } from '../AppShellProvider';
import './index.css';

type MigrationPhase =
  | 'starting'
  | 'backup'
  | 'split-nodes'
  | 'commit'
  | 'done'
  | 'error';

interface MigrationEvent {
  workspaceId: string;
  phase: MigrationPhase;
  current?: number;
  total?: number;
  message?: string;
  /**
   * Set on `'error'` events. `'pollution'` signals the canvas-store-side
   * pollution guard refused a migration because canvas.json was clobbered
   * by a v1-unaware writer — this is a critical data-integrity event that
   * deserves a sticky alert rather than the usual 4s auto-dismissed toast.
   */
  errorKind?: 'pollution' | 'other';
  conflictingNodeIds?: string[];
}

interface VisibleState {
  workspaceId: string;
  phase: MigrationPhase;
  current?: number;
  total?: number;
  message?: string;
}

/**
 * Non-blocking spinner + post-migration toast for canvas storage migration.
 *
 * Subscribes to `canvas:migration-progress` IPC events and:
 *   - Reveals a spinner pill only when a migration runs longer than
 *     {@link DELAY_MS}. Short migrations stay imperceptible — matching
 *     the "no user-facing v1/v2 concept" goal.
 *   - Fires a one-shot success toast after a *real* migration completes
 *     (one that emitted the `backup` phase, i.e. did actual work rather
 *     than no-op on an already-v2 workspace). The toast is intentionally
 *     light: short title + brief description pointing at the .v1.bak
 *     archive, auto-dismissed.
 *
 * Tracks per-workspace whether a real migration was observed so the
 * toast fires once per workspace per migration, not per event.
 */
const DELAY_MS = 1000;
const SUCCESS_TOAST_AUTOCLOSE_MS = 6000;

const PHASE_LABELS: Record<MigrationPhase, string> = {
  starting: '准备升级存储格式…',
  backup: '正在备份原数据…',
  'split-nodes': '正在迁移节点…',
  commit: '正在切换到新格式…',
  done: '已升级',
  error: '升级失败',
};

export const MigrationSpinner = (): JSX.Element | null => {
  const { notify } = useAppShell();

  const [visible, setVisible] = useState<VisibleState | null>(null);
  // Buffer the latest event from the moment a migration starts; the timer
  // promotes it to `visible` once DELAY_MS elapses without a `done`/`error`.
  const pendingRef = useRef<VisibleState | null>(null);
  const timerRef = useRef<number | null>(null);
  // Per-workspace flag: true once we've seen 'backup' for that id, meaning
  // a real migration is in flight (no-ops on already-v2 workspaces never
  // emit 'backup'). Used to fire the success toast only when real work
  // happened.
  const realMigrationRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    const api = window.canvasWorkspace?.store;
    if (!api?.onMigrationProgress) return undefined;

    const clearTimer = (): void => {
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };

    const unsubscribe = api.onMigrationProgress((event: MigrationEvent) => {
      // Track "real migration" markers per workspace independently of the
      // visible spinner state — the toast should fire even for sub-1s
      // migrations the spinner never surfaced.
      if (event.phase === 'backup') {
        realMigrationRef.current.add(event.workspaceId);
      }

      if (event.phase === 'done') {
        // Workspace finished; tear down the spinner.
        pendingRef.current = null;
        clearTimer();
        setVisible(null);
        // Fire the success toast iff we observed real migration work
        // (the `backup` phase) for this workspace. Already-v2 / missing
        // workspaces emit only 'starting' → 'done' and stay silent.
        if (realMigrationRef.current.has(event.workspaceId)) {
          realMigrationRef.current.delete(event.workspaceId);
          notify({
            tone: 'success',
            title: '画布存储已升级',
            description:
              '原数据已备份到工作区目录下的 canvas.json.v1.bak（需要时可手工恢复）。',
            autoCloseMs: SUCCESS_TOAST_AUTOCLOSE_MS,
          });
        }
        return;
      }

      if (event.phase === 'error') {
        // Surface errors immediately even if we're under DELAY_MS — the
        // user should see something rather than nothing.
        pendingRef.current = null;
        clearTimer();
        realMigrationRef.current.delete(event.workspaceId);

        if (event.errorKind === 'pollution') {
          // Critical data-integrity event: canvas.json was clobbered by
          // a v1-unaware writer, and the canvas-store-side guard refused
          // to migrate. Don't surface this through the auto-dismissed
          // spinner pill — fire a sticky `error` toast via the global
          // notify channel that requires explicit dismissal. Data is NOT
          // lost yet (it lives in nodes/<id>.json), but the user must
          // recover before any subsequent save (which the save handler's
          // own guard will also refuse).
          notify({
            tone: 'error',
            title: '检测到画布存储被旧版工具污染',
            description:
              event.message ??
              '已拒绝执行迁移以防止数据丢失。请使用 canvas-cli restore 或参考文档恢复。',
            // No autoCloseMs → sticky; user must dismiss.
          });
          return;
        }

        setVisible({
          workspaceId: event.workspaceId,
          phase: 'error',
          message: event.message,
        });
        // Auto-hide after a few seconds so a transient error toast doesn't
        // pile up.
        window.setTimeout(() => setVisible(null), 4000);
        return;
      }

      // Non-terminal phase: stash the latest event. If we're already
      // visible, update inline (progress changes); otherwise start the
      // delay timer on the first event.
      const next: VisibleState = {
        workspaceId: event.workspaceId,
        phase: event.phase,
        current: event.current,
        total: event.total,
        message: event.message,
      };

      if (visible) {
        setVisible(next);
        return;
      }

      pendingRef.current = next;
      if (timerRef.current === null) {
        timerRef.current = window.setTimeout(() => {
          timerRef.current = null;
          if (pendingRef.current) {
            setVisible(pendingRef.current);
          }
        }, DELAY_MS);
      }
    });

    return () => {
      clearTimer();
      unsubscribe();
    };
    // We intentionally do not depend on `visible`: the IPC handler reads
    // `visible` at handler-invocation time via the closure-captured
    // setter, which gives us "stale but consistent" UX (rapid phase
    // updates won't ping-pong). Subscribing once is correct.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notify]);

  // ─── Startup pollution audit ────────────────────────────────────────
  // Query the main-process scanner once on mount. Each polluted
  // workspace surfaces as a sticky `notify` alert, so users learn about
  // the corruption before clicking into the workspace and seeing empty
  // nodes. Same toast tone/treatment as the live pollution alert above.
  useEffect(() => {
    const api = window.canvasWorkspace?.store;
    if (!api?.listPollutedWorkspaces) return;

    let cancelled = false;
    void api.listPollutedWorkspaces().then((result) => {
      if (cancelled) return;
      if (!result.ok || !Array.isArray(result.polluted)) return;
      for (const finding of result.polluted) {
        notify({
          tone: 'error',
          title: `工作区 "${finding.workspaceId}" 检测到存储污染`,
          description:
            `${finding.conflictingNodeIds.length} 个节点的真实数据仍在 nodes/ 中，` +
            `但 canvas.json 已被旧版工具破坏。请使用 ` +
            `\`canvas-cli restore apply ${finding.workspaceId} --from <snapshot>\` 恢复。`,
          // No autoCloseMs → sticky.
        });
      }
    });

    return () => {
      cancelled = true;
    };
  }, [notify]);

  if (!visible) return null;

  const isError = visible.phase === 'error';
  const label = PHASE_LABELS[visible.phase];
  const showProgress =
    !isError &&
    visible.phase === 'split-nodes' &&
    typeof visible.current === 'number' &&
    typeof visible.total === 'number' &&
    visible.total > 0;

  return (
    <div
      className={`migration-spinner ${isError ? 'migration-spinner--error' : ''}`}
      role="status"
      aria-live="polite"
    >
      {!isError && <span className="migration-spinner__dot" aria-hidden="true" />}
      <span className="migration-spinner__label">{label}</span>
      {showProgress && (
        <span className="migration-spinner__count">
          {visible.current} / {visible.total}
        </span>
      )}
    </div>
  );
};

export default MigrationSpinner;
