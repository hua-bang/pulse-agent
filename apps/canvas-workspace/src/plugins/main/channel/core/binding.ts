import type { PluginStore } from '../../../types';
import { listWorkspaces } from './workspaces';

// Persisted shape, stored under a single plugin-store key.
interface BindingState {
  /** Global fallback workspace when a conversation has no explicit binding. */
  defaultWorkspaceId?: string;
  /** Per-conversation overrides, keyed by `${channelId}:${conversationId}`. */
  perChat: Record<string, string>;
}

const STORE_KEY = 'bindings';

function chatKey(channelId: string, conversationId: string): string {
  return `${channelId}:${conversationId}`;
}

/**
 * Resolves which canvas workspace a given conversation talks to, with a
 * "default + switchable" model:
 *   1. explicit per-conversation binding (set via /bind)
 *   2. stored global default (set via /default)
 *   3. CANVAS_FEISHU_DEFAULT_WORKSPACE env var
 *   4. most-recently-modified workspace on disk
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

  /** Resolve the workspace for a conversation, or undefined if none can be determined. */
  async resolve(channelId: string, conversationId: string): Promise<string | undefined> {
    await this.ensureLoaded();
    const explicit = this.state.perChat[chatKey(channelId, conversationId)];
    if (explicit) return explicit;
    if (this.state.defaultWorkspaceId) return this.state.defaultWorkspaceId;

    const envDefault = process.env.CANVAS_FEISHU_DEFAULT_WORKSPACE?.trim();
    if (envDefault) return envDefault;

    const [mostRecent] = await listWorkspaces();
    return mostRecent?.id;
  }

  /** The workspace explicitly bound to this conversation, if any. */
  async getExplicit(channelId: string, conversationId: string): Promise<string | undefined> {
    await this.ensureLoaded();
    return this.state.perChat[chatKey(channelId, conversationId)];
  }

  async getDefault(): Promise<string | undefined> {
    await this.ensureLoaded();
    return this.state.defaultWorkspaceId;
  }

  /** Bind a conversation to a specific workspace. */
  async bind(channelId: string, conversationId: string, workspaceId: string): Promise<void> {
    await this.ensureLoaded();
    this.state.perChat[chatKey(channelId, conversationId)] = workspaceId;
    await this.persist();
  }

  /** Remove a conversation's explicit binding (falls back to the default). */
  async unbind(channelId: string, conversationId: string): Promise<void> {
    await this.ensureLoaded();
    delete this.state.perChat[chatKey(channelId, conversationId)];
    await this.persist();
  }

  /** Set the global default workspace. */
  async setDefault(workspaceId: string): Promise<void> {
    await this.ensureLoaded();
    this.state.defaultWorkspaceId = workspaceId;
    await this.persist();
  }
}
