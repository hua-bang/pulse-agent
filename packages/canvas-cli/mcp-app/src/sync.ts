import type { App } from '@modelcontextprotocol/ext-apps';
import type { CanvasSnapshot, ViewOperation, WorkspaceSummary } from '../../src/mcp/view-types';
import { callCanvasTool, errorMessage, ToolCallError } from './bridge';
import { coalesceOperations } from './operations';
import type { ViewStore } from './state';

const FLUSH_DELAY_MS = 250;
const POLL_INTERVAL_MS = 4_000;

interface SnapshotResult {
  snapshot: CanvasSnapshot;
  workspaces: WorkspaceSummary[];
}

/**
 * Moves edits between the view and the store.
 *
 * Writes are optimistic: the view mutates its snapshot first, then queued
 * operations are coalesced and sent as one `canvas_apply`, one call at a
 * time. Reads poll a cheap version token and reload the snapshot only when
 * someone else (the app, the CLI, or the agent) changed the canvas, and
 * never while the user is mid-interaction or edits are unsent.
 */
export class SyncEngine {
  private queue: ViewOperation[] = [];
  private flushing: Promise<void> | null = null;
  private flushTimer: ReturnType<typeof setTimeout> | undefined;
  private pollTimer: ReturnType<typeof setInterval> | undefined;
  private polling = false;

  constructor(
    private readonly app: App,
    private readonly store: ViewStore,
    private readonly onError: (message: string) => void,
  ) {}

  get pending(): boolean {
    return this.queue.length > 0 || this.flushing !== null;
  }

  async load(workspaceId?: string): Promise<void> {
    this.store.setStatus('loading');
    try {
      const result = await callCanvasTool<SnapshotResult>(
        this.app,
        'canvas_ui_snapshot',
        workspaceId ? { workspaceId } : {},
      );
      this.store.setSnapshot(result.snapshot, result.workspaces);
      this.store.setStatus('idle');
    } catch (err) {
      if (err instanceof ToolCallError && /workspace/.test(err.code) && !workspaceId) {
        await this.showPicker();
        return;
      }
      this.store.setStatus('error', errorMessage(err));
    }
  }

  /** Nothing to open yet: list workspaces so the user can pick one. */
  async showPicker(): Promise<void> {
    try {
      const listed = await callCanvasTool<{ workspaces: WorkspaceSummary[] }>(this.app, 'canvas_list_workspaces', {});
      this.store.update(state => {
        state.workspaces = listed.workspaces;
        state.status = { kind: 'idle', message: 'Pick a workspace to open.' };
      });
    } catch (err) {
      this.store.setStatus('error', errorMessage(err));
    }
  }

  enqueue(...operations: ViewOperation[]): void {
    this.queue.push(...operations);
    this.store.setStatus('saving');
    clearTimeout(this.flushTimer);
    this.flushTimer = setTimeout(() => void this.flush(), FLUSH_DELAY_MS);
  }

  /** Send every queued edit; resolves once the store has them (or failed). */
  async flush(): Promise<void> {
    clearTimeout(this.flushTimer);
    while (this.flushing) await this.flushing;
    const snapshot = this.store.state.snapshot;
    if (this.queue.length === 0 || !snapshot) return;
    const operations = coalesceOperations(this.queue.splice(0));
    if (operations.length === 0) {
      this.store.setStatus('saved');
      return;
    }
    this.flushing = this.send(snapshot.workspaceId, operations).finally(() => {
      this.flushing = null;
    });
    await this.flushing;
    if (this.queue.length > 0) await this.flush();
  }

  private async send(workspaceId: string, operations: ViewOperation[]): Promise<void> {
    try {
      const report = await callCanvasTool<{ version: string | null }>(this.app, 'canvas_apply', {
        workspaceId,
        operations,
      });
      const snapshot = this.store.state.snapshot;
      if (snapshot && snapshot.workspaceId === workspaceId && report.version) snapshot.version = report.version;
      this.store.setStatus(this.queue.length > 0 ? 'saving' : 'saved');
    } catch (err) {
      // The optimistic snapshot is now wrong; drop later edits built on it and reload.
      this.queue = [];
      this.onError(`Could not save: ${errorMessage(err)}`);
      await this.load(workspaceId);
      this.store.setStatus('error', `Could not save: ${errorMessage(err)}`);
    }
  }

  startPolling(): void {
    this.stopPolling();
    this.pollTimer = setInterval(() => void this.poll(), POLL_INTERVAL_MS);
  }

  stopPolling(): void {
    clearInterval(this.pollTimer);
    this.pollTimer = undefined;
  }

  async poll(): Promise<void> {
    const snapshot = this.store.state.snapshot;
    if (!snapshot || this.polling || this.pending || this.store.state.interacting) return;
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
    this.polling = true;
    try {
      const current = await callCanvasTool<{ version: string }>(this.app, 'canvas_ui_version', {
        workspaceId: snapshot.workspaceId,
      });
      const latest = this.store.state.snapshot;
      if (
        latest?.workspaceId === snapshot.workspaceId
        && current.version !== latest.version
        && !this.pending
        && !this.store.state.interacting
      ) {
        await this.load(snapshot.workspaceId);
      }
    } catch {
      // Transient host/tool failure: the next tick retries.
    } finally {
      this.polling = false;
    }
  }
}
