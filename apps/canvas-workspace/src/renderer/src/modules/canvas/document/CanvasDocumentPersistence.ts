import type { CanvasSaveData } from '../../../types';
import { copyDocument, mergeDocumentRevision, sameDocumentContent } from './revisionMerge';

interface SaveResult {
  ok: boolean;
  revision?: number;
  storageGeneration?: string;
  error?: string;
  code?: string;
  data?: CanvasSaveData | null;
}

interface PersistenceOptions {
  workspaceId: string;
  save: (data: CanvasSaveData) => Promise<SaveResult>;
  load: () => Promise<CanvasSaveData>;
  publish: (data: CanvasSaveData) => void;
  persisted: (data: CanvasSaveData) => void;
  failed: (error: unknown) => void;
}

const workspaceQueues = new Map<string, Promise<void>>();

function serialize(workspaceId: string, operation: () => Promise<void>): Promise<void> {
  const previous = workspaceQueues.get(workspaceId) ?? Promise.resolve();
  const current = previous.catch(() => undefined).then(operation);
  const settled = current.then(() => undefined, () => undefined);
  workspaceQueues.set(workspaceId, settled);
  void settled.then(() => {
    if (workspaceQueues.get(workspaceId) === settled) workspaceQueues.delete(workspaceId);
  });
  return current;
}

/** Owns a durable baseline independently of the hook's currently mounted workspace. */
export class CanvasDocumentPersistence {
  private baseline: CanvasSaveData | null = null;
  private draft: CanvasSaveData | null = null;
  private external: CanvasSaveData | null = null;
  private editVersion = 0;
  private savedVersion = 0;
  private requested = false;
  private blocked = false;
  private running: Promise<void> | null = null;
  private refreshing: Promise<CanvasSaveData> | null = null;

  constructor(private readonly options: PersistenceOptions) {}

  initialize(data: CanvasSaveData): void {
    this.baseline = copyDocument(data);
    this.draft = copyDocument(data);
    this.editVersion = 0;
    this.savedVersion = 0;
  }

  get hasChanges(): boolean {
    return this.editVersion !== this.savedVersion;
  }

  get storageGeneration(): string | undefined {
    return this.baseline?.storageGeneration;
  }

  setDraft(data: CanvasSaveData): void {
    if (!this.draft || sameDocumentContent(this.draft, data)) return;
    // History publishes immutable arrays. Keep their references while dragging;
    // clone only at persistence/merge boundaries, not on every pointer event.
    this.draft = data;
    this.editVersion += 1;
  }

  /** The unversioned backend keeps its existing event-specific merge policy. */
  setLegacyDraft(data: CanvasSaveData): void {
    this.draft = data;
  }

  async receiveExternal(data: CanvasSaveData): Promise<void> {
    if (!this.baseline || !this.draft) return;
    if (data.storageGeneration === this.baseline.storageGeneration
      && data.revision !== undefined && this.baseline.revision !== undefined
      && data.revision <= this.baseline.revision) return;
    if (this.external?.storageGeneration === data.storageGeneration
      && this.external?.revision !== undefined && data.revision !== undefined
      && data.revision < this.external.revision) return;
    this.external = copyDocument(data);
    this.blocked = false;
    // An event may observe a commit before its save acknowledgement arrives.
    if (!this.running) await this.reconcileExternal();
  }

  requestSave(): Promise<void> {
    if (!this.baseline || !this.draft) return Promise.resolve();
    this.requested = true;
    this.blocked = false;
    if (this.running) return this.running;
    this.running = serialize(this.options.workspaceId, () => this.drain())
      .finally(async () => {
        this.running = null;
        if (this.external && !this.blocked) await this.reconcileExternal();
        if (this.requested) return this.requestSave();
      });
    return this.running;
  }

  private async reconcileExternal(): Promise<boolean> {
    if (!this.external || !this.baseline || !this.draft) return true;
    let confirmedBackend = false;
    if (this.external.storageGeneration !== this.baseline.storageGeneration) {
      // A migration/replacement may reuse the same numeric revision. Verify
      // the current backend before rebasing; never just replace its token.
      const requestedGeneration = this.external.storageGeneration;
      try {
        this.refreshing ??= this.options.load().finally(() => { this.refreshing = null; });
        const fresh = await this.refreshing;
        if (this.blocked) return false;
        if (!this.external) return true;
        if (this.external.storageGeneration !== requestedGeneration
          && this.external.storageGeneration !== fresh.storageGeneration) {
          throw new Error('Canvas storage changed again while confirming its generation');
        }
        const newerPending = fresh.storageGeneration === this.external.storageGeneration
          && fresh.revision !== undefined && this.external.revision !== undefined
          && this.external.revision > fresh.revision;
        if (!newerPending) this.external = copyDocument(fresh);
        confirmedBackend = true;
      } catch (error) {
        this.blocked = true;
        this.requested = false;
        this.options.failed(error);
        return false;
      }
    }
    if (this.external.storageGeneration === this.baseline.storageGeneration
      && this.external.revision !== undefined && this.baseline.revision !== undefined
      && this.external.revision <= this.baseline.revision) {
      this.external = null;
      return true;
    }
    const result = mergeDocumentRevision(this.baseline, this.draft, this.external, {
      allowStorageGenerationChange: confirmedBackend,
    });
    if (!result.ok) {
      this.blocked = true;
      this.options.failed(new Error(`Canvas changes conflict: ${result.conflicts.join(', ')}`));
      return false;
    }
    this.baseline = this.external;
    this.external = null;
    this.draft = result.data;
    this.options.persisted(this.baseline);
    this.options.publish(copyDocument(this.draft));
    return true;
  }

  private async drain(): Promise<void> {
    let conflictRetries = 0;
    while (this.requested && this.baseline && this.draft) {
      this.requested = false;
      if (!await this.reconcileExternal()) return;
      const sentVersion = this.editVersion;
      const payload = copyDocument({
        ...this.draft,
        revision: this.baseline.revision,
        storageGeneration: this.baseline.storageGeneration,
        savedAt: new Date().toISOString(),
      });
      try {
        const result = await this.options.save(payload);
        if (result.ok) {
          this.baseline = {
            ...payload,
            revision: result.revision ?? payload.revision,
            storageGeneration: result.storageGeneration ?? payload.storageGeneration,
          };
          this.savedVersion = sentVersion;
          this.options.persisted(this.baseline);
          if (!await this.reconcileExternal()) return;
          this.requested = this.editVersion !== sentVersion;
          continue;
        }
        if (result.code !== 'revision_conflict') throw new Error(result.error ?? 'Canvas save failed');
        const remote = result.data ?? await this.options.load();
        await this.receiveExternal(remote);
        if (!await this.reconcileExternal()) return;
        if (conflictRetries >= 1) throw new Error(result.error ?? 'Canvas changed again while saving');
        conflictRetries += 1;
        this.requested = true;
      } catch (error) {
        this.requested = false;
        this.blocked = true;
        this.options.failed(error);
        return;
      }
    }
  }
}
