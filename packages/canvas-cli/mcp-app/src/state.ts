import type { CanvasSnapshot, ViewNode, WorkspaceSummary } from '../../src/mcp/view-types';
import type { Transform } from './geometry';

export type DisplayMode = 'inline' | 'fullscreen' | 'pip';

export type StatusKind = 'idle' | 'loading' | 'saving' | 'saved' | 'error';

export interface ViewState {
  snapshot: CanvasSnapshot | null;
  workspaces: WorkspaceSummary[];
  transform: Transform;
  selectedNodes: Set<string>;
  selectedEdge: string | null;
  connectMode: boolean;
  connectFrom: string | null;
  status: { kind: StatusKind; message?: string };
  displayMode: DisplayMode;
  availableDisplayModes: DisplayMode[];
  /** Interaction in progress (drag, resize, pan, edit); sync must not reload. */
  interacting: boolean;
}

export type Listener = (state: ViewState) => void;

/** Single mutable view state with coarse change notification. */
export class ViewStore {
  readonly state: ViewState = {
    snapshot: null,
    workspaces: [],
    transform: { x: 0, y: 0, scale: 1 },
    selectedNodes: new Set(),
    selectedEdge: null,
    connectMode: false,
    connectFrom: null,
    status: { kind: 'idle' },
    displayMode: 'inline',
    availableDisplayModes: ['inline'],
    interacting: false,
  };

  private listeners = new Set<Listener>();

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  update(mutate: (state: ViewState) => void): void {
    mutate(this.state);
    for (const listener of this.listeners) listener(this.state);
  }

  node(id: string): ViewNode | undefined {
    return this.state.snapshot?.nodes.find(node => node.id === id);
  }

  /** Replace the snapshot, keeping selection for ids that still exist. */
  setSnapshot(snapshot: CanvasSnapshot, workspaces?: WorkspaceSummary[]): void {
    this.update(state => {
      const ids = new Set(snapshot.nodes.map(node => node.id));
      const edgeIds = new Set(snapshot.edges.map(edge => edge.id));
      const sameWorkspace = state.snapshot?.workspaceId === snapshot.workspaceId;
      state.selectedNodes = sameWorkspace
        ? new Set([...state.selectedNodes].filter(id => ids.has(id)))
        : new Set();
      if (!sameWorkspace || (state.selectedEdge && !edgeIds.has(state.selectedEdge))) state.selectedEdge = null;
      state.snapshot = snapshot;
      if (workspaces) state.workspaces = workspaces;
    });
  }

  setStatus(kind: StatusKind, message?: string): void {
    this.update(state => {
      state.status = { kind, message };
    });
  }
}
