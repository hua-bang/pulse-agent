import { useEffect, useRef, useState } from 'react';
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
}

interface VisibleState {
  workspaceId: string;
  phase: MigrationPhase;
  current?: number;
  total?: number;
  message?: string;
}

/**
 * Non-blocking spinner for canvas storage migration.
 *
 * Subscribes to `canvas:migration-progress` IPC events and reveals itself
 * only when a migration runs longer than {@link DELAY_MS}. Short migrations
 * (typical workspaces complete in well under 1s) never show anything, so
 * the migration stays imperceptible — matching the "no user-facing v1/v2
 * concept" goal.
 *
 * Dormant in PR1 because no caller fires the IPC event yet; PR3 wires
 * lazy auto-migration into `readCanvasFull` and this component lights up
 * for any workspace large enough to notice.
 */
const DELAY_MS = 1000;

const PHASE_LABELS: Record<MigrationPhase, string> = {
  starting: '准备升级存储格式…',
  backup: '正在备份原数据…',
  'split-nodes': '正在迁移节点…',
  commit: '正在切换到新格式…',
  done: '已升级',
  error: '升级失败',
};

export const MigrationSpinner = (): JSX.Element | null => {
  const [visible, setVisible] = useState<VisibleState | null>(null);
  // Buffer the latest event from the moment a migration starts; the timer
  // promotes it to `visible` once DELAY_MS elapses without a `done`/`error`.
  const pendingRef = useRef<VisibleState | null>(null);
  const timerRef = useRef<number | null>(null);

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
      if (event.phase === 'done') {
        // Workspace finished; tear down. If the spinner had already
        // surfaced, hide it; if it was still buffering, nothing visible
        // ever appeared.
        pendingRef.current = null;
        clearTimer();
        setVisible(null);
        return;
      }

      if (event.phase === 'error') {
        // Surface errors immediately even if we're under DELAY_MS — the
        // user should see "升级失败" rather than nothing.
        pendingRef.current = null;
        clearTimer();
        setVisible({
          workspaceId: event.workspaceId,
          phase: 'error',
          message: event.message,
        });
        // Auto-hide after a few seconds so an error toast doesn't pile up.
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
  }, []);

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
