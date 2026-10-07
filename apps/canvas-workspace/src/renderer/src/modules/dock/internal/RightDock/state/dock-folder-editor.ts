export interface FileDraft {
  path: string;
  content: string;
  original: string;
  version: string;
}
export interface FolderEditorSnapshot {
  draft?: FileDraft;
  saving?: boolean;
  error?: string;
  pending?: () => void;
}
const EMPTY: FolderEditorSnapshot = {};
export const isFileDirty = (state: FolderEditorSnapshot): boolean => Boolean(state.draft && state.draft.content !== state.draft.original);

/** Drafts survive scope unmounts, but are deliberately not persisted to disk. */
export class DockFolderEditor {
  private scopes = new Map<string, FolderEditorSnapshot>();
  private listeners = new Set<() => void>();
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  get = (scope: string): FolderEditorSnapshot => this.scopes.get(scope) ?? EMPTY;
  update(scope: string, patch: Partial<FolderEditorSnapshot>): void {
    this.scopes.set(scope, { ...this.get(scope), ...patch });
    for (const listener of this.listeners) listener();
  }
  edit(scope: string, content: string): void {
    const draft = this.get(scope).draft;
    if (draft) this.update(scope, { draft: { ...draft, content } });
  }
  allow(scope: string, action: () => void): boolean {
    const state = this.get(scope);
    if (!isFileDirty(state) && !state.saving) return true;
    if (!state.pending) this.update(scope, { pending: action });
    return false;
  }
  discard(scope: string): void { this.update(scope, { draft: undefined, error: undefined }); }
  proceed(scope: string): void {
    const action = this.get(scope).pending;
    this.update(scope, { pending: undefined });
    action?.();
  }
}
