import type { PluginStore } from '../../../types';

// Persisted shape, stored under a single plugin-store key.
interface BindingState {
  /** Suggested workspace for /bind without an argument (not auto-applied). */
  defaultWorkspaceId?: string;
  /** Per-conversation bindings, keyed by `${channelId}:${conversationId}`. */
  perChat: Record<string, string>;
}

const STORE_KEY = 'bindings';

function chatKey(channelId: string, conversationId: string): string {
  return `${channelId}:${conversationId}`;
}

/**
 * Tracks which canvas workspace each conversation is bound to.
 *
 * Binding is **explicit and sticky**: a conversation only talks to a
 * workspace once the user has bound it (via /bind), and that choice never
 * changes on its own. There is intentionally no implicit fallback (e.g.
 * "most-recently-modified"), so a conversation can never silently switch
 * workspaces mid-chat. A stored/env default is offered only as a suggestion
 * for `/bind` with no argument — it is not auto-applied.
 *
 * State is persisted via the plugin's own {@link PluginStore}.
 */
export class BindingStore {
  private state: BindingState = { perChat: {} };
  private loaded = false;

  constructor(private readonly store: PluginStore) {}

  private async ensureLoaded(): Promise<void> {
    if (this.loaded) return;
    const saved = await this.store.get<BindingState>(STORE_KEY);
    if (saved) {
      this.state = { defaultWorkspaceId: saved.defaultWorkspaceId, perChat: saved.perChat ?? {} };
    }
    this.loaded = true;
  }

  private async persist(): Promise<void> {
    await this.store.set(STORE_KEY, this.state);
  }

  /** The workspace this conversation is bound to, or undefined if unbound. */
  async getBound(channelId: string, conversationId: string): Promise<string | undefined> {
    await this.ensureLoaded();
    return this.state.perChat[chatKey(channelId, conversationId)];
  }

  /**
   * The suggested default workspace (stored value, else the
   * CANVAS_FEISHU_DEFAULT_WORKSPACE env var). Only used to assist `/bind`;
   * never auto-applied to a conversation.
   */
  async getSuggestedDefault(): Promise<string | undefined> {
    await this.ensureLoaded();
    return this.state.defaultWorkspaceId ?? (process.env.CANVAS_FEISHU_DEFAULT_WORKSPACE?.trim() || undefined);
  }

  /** Bind a conversation to a specific workspace. */
  async bind(channelId: string, conversationId: string, workspaceId: string): Promise<void> {
    await this.ensureLoaded();
    this.state.perChat[chatKey(channelId, conversationId)] = workspaceId;
    await this.persist();
  }

  /** Remove a conversation's binding. */
  async unbind(channelId: string, conversationId: string): Promise<void> {
    await this.ensureLoaded();
    delete this.state.perChat[chatKey(channelId, conversationId)];
    await this.persist();
  }

  /** Set the suggested default workspace. */
  async setDefault(workspaceId: string): Promise<void> {
    await this.ensureLoaded();
    this.state.defaultWorkspaceId = workspaceId;
    await this.persist();
  }
}
