import type { CanvasAgentServiceRef, PluginStore } from '../../../types';

const STORE_KEY = 'sessions';

/**
 * Gives each external conversation its own Canvas Agent session, even when
 * several conversations share one workspace.
 *
 * Canvas keeps a single *current* session per workspace; this router maps
 * `workspaceId::conversationId → sessionId` and, before each turn, swaps the
 * workspace's current session to the one owned by the conversation (creating
 * it on first contact). Because runs are serialized per workspace, the swap
 * can't race another turn. The map is persisted so conversations keep their
 * history across restarts.
 *
 * Trade-off: the workspace's *current* session is shared with the Canvas UI,
 * so the UI for that workspace reflects whichever conversation ran last.
 */
export class SessionRouter {
  private map: Record<string, string> = {};
  private loaded = false;

  constructor(
    private readonly service: CanvasAgentServiceRef,
    private readonly store: PluginStore,
  ) {}

  private async ensureLoaded(): Promise<void> {
    if (this.loaded) return;
    this.map = (await this.store.get<Record<string, string>>(STORE_KEY)) ?? {};
    this.loaded = true;
  }

  private key(workspaceId: string, conversationId: string): string {
    return `${workspaceId}::${conversationId}`;
  }

  /**
   * Ensure the workspace's current session is the one owned by
   * `conversationId`. Call inside the per-workspace run guard, before chat.
   */
  async ensureSession(workspaceId: string, conversationId: string): Promise<void> {
    await this.ensureLoaded();
    const key = this.key(workspaceId, conversationId);
    const desired = this.map[key];

    if (desired) {
      if (this.service.getCurrentSessionId(workspaceId) === desired) return;
      await this.service.loadSession(workspaceId, desired);
      // loadSession is a no-op when the session no longer exists; confirm it
      // actually became current, otherwise fall through to a fresh one.
      if (this.service.getCurrentSessionId(workspaceId) === desired) return;
    }

    await this.service.newSession(workspaceId);
    const fresh = this.service.getCurrentSessionId(workspaceId);
    if (fresh) {
      this.map[key] = fresh;
      await this.store.set(STORE_KEY, this.map);
    }
  }
}
