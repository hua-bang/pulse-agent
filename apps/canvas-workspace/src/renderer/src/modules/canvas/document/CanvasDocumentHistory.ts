import type { CanvasEdge, CanvasNode } from '../../../types';
import {
  diffExternalChange,
  isEmptyDelta,
  rebaseOnExternalChange,
} from './historyRebase';
import { dropDanglingEdges } from './revisionMerge';

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

  /**
   * Adopt a state that another writer (the Canvas Agent, the CLI) changed.
   *
   * The change is not an undo step of this user, so it adds no entry. It is
   * applied to every recorded state instead: undo and redo restore whole
   * states, and a state recorded before the change would otherwise remove
   * the other writer's nodes when it is restored.
   */
  applyExternal(next: CanvasDocumentSnapshot): CanvasDocumentSnapshot {
    const previous = this.snapshot;
    const nodeDelta = diffExternalChange(previous.nodes, next.nodes);
    const edgeDelta = diffExternalChange(previous.edges, next.edges);
    const recordedAtCursor = this.entries[this.cursor];
    const cursorIsCurrent = recordedAtCursor.nodes === previous.nodes
      && recordedAtCursor.edges === previous.edges;

    if (!isEmptyDelta(nodeDelta) || !isEmptyDelta(edgeDelta)) {
      this.entries = this.entries.map((entry) => {
        const nodes = rebaseOnExternalChange(entry.nodes, nodeDelta);
        const edges = dropDanglingEdges(rebaseOnExternalChange(entry.edges, edgeDelta), nodes);
        return nodes === entry.nodes && edges === entry.edges ? entry : { nodes, edges };
      });
    }
    // Keep the recorded state identical to the published one, so the next
    // `commit` does not record the external change as a step of this user.
    if (cursorIsCurrent) this.entries[this.cursor] = next;
    this.snapshot = next;
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
