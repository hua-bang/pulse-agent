import type { CanvasEdge, CanvasNode } from '../../../types';

export interface CanvasDocumentSnapshot {
  nodes: CanvasNode[];
  edges: CanvasEdge[];
}

const MAX_HISTORY = 100;

export class CanvasDocumentHistory {
  private entries: CanvasDocumentSnapshot[];
  private cursor = 0;
  private snapshot: CanvasDocumentSnapshot;

  constructor(initial: CanvasDocumentSnapshot) {
    this.entries = [initial];
    this.snapshot = initial;
  }

  get current(): CanvasDocumentSnapshot {
    return this.snapshot;
  }

  reset(snapshot: CanvasDocumentSnapshot): void {
    this.entries = [snapshot];
    this.cursor = 0;
    this.snapshot = snapshot;
  }

  apply(patch: Partial<CanvasDocumentSnapshot>, addToHistory = true): CanvasDocumentSnapshot {
    const next = {
      nodes: patch.nodes ?? this.snapshot.nodes,
      edges: patch.edges ?? this.snapshot.edges,
    };
    this.snapshot = next;
    if (addToHistory) this.push(next);
    return next;
  }

  commit(): boolean {
    const recorded = this.entries[this.cursor];
    if (recorded.nodes === this.snapshot.nodes && recorded.edges === this.snapshot.edges) {
      return false;
    }
    this.push(this.snapshot);
    return true;
  }

  undo(): CanvasDocumentSnapshot | null {
    if (this.cursor <= 0) return null;
    this.cursor -= 1;
    this.snapshot = this.entries[this.cursor];
    return this.snapshot;
  }

  redo(): CanvasDocumentSnapshot | null {
    if (this.cursor >= this.entries.length - 1) return null;
    this.cursor += 1;
    this.snapshot = this.entries[this.cursor];
    return this.snapshot;
  }

  private push(snapshot: CanvasDocumentSnapshot): void {
    const next = this.entries.slice(0, this.cursor + 1);
    next.push(snapshot);
    if (next.length > MAX_HISTORY) next.shift();
    this.entries = next;
    this.cursor = next.length - 1;
  }
}
