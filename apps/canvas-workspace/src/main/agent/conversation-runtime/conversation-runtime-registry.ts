import {
  conversationKeyId,
  type ConversationKey,
} from '../../../shared/conversation-runtime';
import {
  ConversationRuntime,
  type ConversationRuntimeDeps,
} from './conversation-runtime';

/**
 * Registry of per-conversation runtimes within a single workspace. The
 * workspace still owns the shared Engine (tools / MCP / config / plan-mode);
 * this registry only owns the per-conversation *state* and hands each runtime
 * the same runner + store through {@link ConversationRuntimeRegistryOptions.create}.
 */
export interface ConversationRuntimeRegistryOptions {
  create: (key: ConversationKey) => ConversationRuntimeDeps;
}

export class ConversationRuntimeRegistry {
  private readonly runtimes = new Map<string, ConversationRuntime>();

  constructor(private readonly options: ConversationRuntimeRegistryOptions) {}

  /** Open (or return the existing) runtime for a conversation, loading its messages. */
  async open(key: ConversationKey): Promise<ConversationRuntime> {
    const id = conversationKeyId(key);
    let runtime = this.runtimes.get(id);
    if (!runtime) {
      runtime = new ConversationRuntime(this.options.create(key));
      this.runtimes.set(id, runtime);
    }
    await runtime.open();
    return runtime;
  }

  get(key: ConversationKey): ConversationRuntime | undefined {
    return this.runtimes.get(conversationKeyId(key));
  }

  async dispose(key: ConversationKey): Promise<void> {
    const id = conversationKeyId(key);
    const runtime = this.runtimes.get(id);
    if (!runtime) return;
    runtime.dispose();
    this.runtimes.delete(id);
  }

  disposeAll(): void {
    for (const runtime of this.runtimes.values()) runtime.dispose();
    this.runtimes.clear();
  }

  runningSessionIds(): string[] {
    return [...this.runtimes.values()]
      .filter(runtime => runtime.getSnapshot().status === 'running')
      .map(runtime => runtime.key.sessionId);
  }

  get size(): number {
    return this.runtimes.size;
  }
}
