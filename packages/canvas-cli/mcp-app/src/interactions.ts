import type { ViewNode } from '../../src/mcp/view-types';
import { containedIds, resizedRect, screenToWorld, zoomAt, type Point } from './geometry';
import type { NodeEditor } from './editor';
import { newViewId } from './operations';
import { isContainer, type Renderer } from './render';
import type { ViewStore } from './state';
import type { SyncEngine } from './sync';

const DRAG_THRESHOLD = 3;

type Gesture =
  | { kind: 'pan'; start: Point; origin: Point; moved: boolean }
  | { kind: 'drag'; start: Point; ids: string[]; origins: Map<string, Point>; moved: boolean }
  | { kind: 'resize'; start: Point; id: string; origin: { width: number; height: number }; moved: boolean };

/**
 * Pointer, wheel, and keyboard handling for the canvas viewport. Gestures
 * mutate the snapshot optimistically and enqueue one operation batch when
 * the pointer is released.
 */
export class Interactions {
  private gesture: Gesture | null = null;

  constructor(
    private readonly viewport: HTMLElement,
    private readonly store: ViewStore,
    private readonly renderer: Renderer,
    private readonly sync: SyncEngine,
    private readonly editor: NodeEditor,
  ) {}

  attach(): void {
    this.viewport.addEventListener('pointerdown', event => this.onPointerDown(event));
    this.viewport.addEventListener('pointermove', event => this.onPointerMove(event));
    this.viewport.addEventListener('pointerup', event => this.onPointerUp(event));
    this.viewport.addEventListener('pointercancel', event => this.onPointerUp(event));
    this.viewport.addEventListener('dblclick', event => this.onDoubleClick(event));
    this.viewport.addEventListener('wheel', event => this.onWheel(event), { passive: false });
    window.addEventListener('keydown', event => this.onKeyDown(event));
  }

  private local(event: { clientX: number; clientY: number }): Point {
    const rect = this.viewport.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  /** World point at the viewport center, for toolbar-created nodes. */
  viewportCenter(): Point {
    const rect = this.viewport.getBoundingClientRect();
    return screenToWorld(this.store.state.transform, { x: rect.width / 2, y: rect.height / 2 });
  }

  private onPointerDown(event: PointerEvent): void {
    if (event.button !== 0 || this.editor.editing) return;
    const target = event.target as HTMLElement;
    const nodeElement = target.closest<HTMLElement>('[data-node-id]');
    const edgeElement = target.closest<Element>('[data-edge-id]');
    const point = this.local(event);
    const state = this.store.state;

    if (nodeElement) {
      const id = nodeElement.dataset.nodeId!;
      if (state.connectMode) {
        this.connect(id);
        return;
      }
      if (target.closest('[data-role="resize"]')) {
        const node = this.store.node(id);
        if (!node) return;
        this.begin(event, { kind: 'resize', start: point, id, origin: { width: node.width, height: node.height }, moved: false });
        return;
      }
      this.select(id, event.shiftKey);
      this.beginDrag(event, point);
      return;
    }
    if (edgeElement) {
      const edgeId = edgeElement.getAttribute('data-edge-id');
      this.store.update(s => {
        s.selectedEdge = edgeId;
        s.selectedNodes = new Set();
      });
      this.renderer.renderSelection(this.store.state);
      return;
    }
    if (!event.shiftKey) {
      this.store.update(s => {
        s.selectedNodes = new Set();
        s.selectedEdge = null;
        s.connectFrom = null;
      });
      this.renderer.renderSelection(this.store.state);
    }
    this.begin(event, { kind: 'pan', start: point, origin: { x: state.transform.x, y: state.transform.y }, moved: false });
  }

  private begin(_event: PointerEvent, gesture: Gesture): void {
    // Pointer capture waits for real movement (onPointerMove): capturing on
    // pointerdown retargets the following click/dblclick to the viewport.
    this.gesture = gesture;
    this.store.state.interacting = true;
  }

  private beginDrag(event: PointerEvent, point: Point): void {
    const nodes = this.store.state.snapshot?.nodes ?? [];
    const ids = new Set(this.store.state.selectedNodes);
    // Frames carry the nodes inside them, like the app does.
    for (const id of [...ids]) {
      const node = this.store.node(id);
      if (node && isContainer(node)) for (const child of containedIds(node, nodes)) ids.add(child);
    }
    const origins = new Map<string, Point>();
    for (const id of ids) {
      const node = this.store.node(id);
      if (node) origins.set(id, { x: node.x, y: node.y });
    }
    this.begin(event, { kind: 'drag', start: point, ids: [...origins.keys()], origins, moved: false });
  }

  private onPointerMove(event: PointerEvent): void {
    const gesture = this.gesture;
    if (!gesture) return;
    const point = this.local(event);
    const dx = point.x - gesture.start.x;
    const dy = point.y - gesture.start.y;
    if (!gesture.moved) {
      if (Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
      gesture.moved = true;
      this.viewport.setPointerCapture(event.pointerId);
    }
    const scale = this.store.state.transform.scale;

    if (gesture.kind === 'pan') {
      this.store.state.transform = { ...this.store.state.transform, x: gesture.origin.x + dx, y: gesture.origin.y + dy };
      this.renderer.applyTransform(this.store.state);
    } else if (gesture.kind === 'drag') {
      for (const [id, origin] of gesture.origins) {
        const node = this.store.node(id);
        if (!node) continue;
        node.x = Math.round(origin.x + dx / scale);
        node.y = Math.round(origin.y + dy / scale);
      }
      this.renderer.moveNodes(gesture.ids);
    } else {
      const node = this.store.node(gesture.id);
      if (!node) return;
      const next = resizedRect({ x: node.x, y: node.y, ...gesture.origin }, dx / scale, dy / scale);
      node.width = next.width;
      node.height = next.height;
      this.renderer.moveNodes([gesture.id]);
    }
  }

  private onPointerUp(event: PointerEvent): void {
    const gesture = this.gesture;
    if (!gesture) return;
    this.gesture = null;
    this.store.state.interacting = false;
    if (this.viewport.hasPointerCapture(event.pointerId)) this.viewport.releasePointerCapture(event.pointerId);
    if (!gesture.moved) return;
    if (gesture.kind === 'drag') {
      this.sync.enqueue(...gesture.ids.flatMap(id => {
        const node = this.store.node(id);
        return node ? [{ action: 'update' as const, id, x: node.x, y: node.y }] : [];
      }));
    } else if (gesture.kind === 'resize') {
      const node = this.store.node(gesture.id);
      if (node) this.sync.enqueue({ action: 'update', id: node.id, width: node.width, height: node.height });
    }
  }

  private onDoubleClick(event: MouseEvent): void {
    if (this.editor.editing || this.store.state.connectMode) return;
    const target = event.target as HTMLElement;
    const nodeElement = target.closest<HTMLElement>('[data-node-id]');
    if (nodeElement) {
      const id = nodeElement.dataset.nodeId!;
      if (target.closest('[data-role="header"]')) this.editor.editTitle(id);
      else this.editor.editBody(id);
      return;
    }
    if (target.closest('[data-edge-id]') || !this.store.state.snapshot) return;
    const world = screenToWorld(this.store.state.transform, this.local(event));
    this.createNode('file', { x: world.x - 160, y: world.y - 40 }, true);
  }

  private onWheel(event: WheelEvent): void {
    event.preventDefault();
    const state = this.store.state;
    if (event.ctrlKey || event.metaKey) {
      const factor = Math.exp(-event.deltaY * 0.01);
      state.transform = zoomAt(state.transform, factor, this.local(event));
    } else {
      state.transform = { ...state.transform, x: state.transform.x - event.deltaX, y: state.transform.y - event.deltaY };
    }
    this.store.update(() => undefined);
  }

  private onKeyDown(event: KeyboardEvent): void {
    if (this.editor.editing) return;
    const tag = (event.target as HTMLElement | null)?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault();
      this.deleteSelection();
    } else if (event.key === 'Escape') {
      this.store.update(s => {
        s.selectedNodes = new Set();
        s.selectedEdge = null;
        s.connectMode = false;
        s.connectFrom = null;
      });
      this.renderer.renderSelection(this.store.state);
    }
  }

  select(id: string, additive: boolean): void {
    this.store.update(state => {
      const next = additive ? new Set(state.selectedNodes) : new Set<string>();
      if (additive && next.has(id)) next.delete(id);
      else next.add(id);
      if (!additive && state.selectedNodes.has(id)) {
        // Keep a multi-selection intact so it can be dragged together.
        for (const existing of state.selectedNodes) next.add(existing);
      }
      state.selectedNodes = next;
      state.selectedEdge = null;
    });
    this.renderer.renderSelection(this.store.state);
  }

  private connect(id: string): void {
    const state = this.store.state;
    if (!state.connectFrom) {
      this.store.update(s => {
        s.connectFrom = id;
      });
      this.renderer.renderSelection(this.store.state);
      return;
    }
    const from = state.connectFrom;
    this.store.update(s => {
      s.connectFrom = null;
    });
    if (from === id || !state.snapshot) {
      this.renderer.renderSelection(this.store.state);
      return;
    }
    const edgeId = newViewId('edge');
    state.snapshot.edges.push({ id: edgeId, source: { kind: 'node', nodeId: from }, target: { kind: 'node', nodeId: id } });
    this.sync.enqueue({ action: 'createEdge', id: edgeId, from, to: id });
    this.renderer.renderSelection(this.store.state);
  }

  createNode(type: 'file' | 'frame', at: Point, edit = false): void {
    const snapshot = this.store.state.snapshot;
    if (!snapshot) return;
    const size = type === 'frame' ? { width: 720, height: 480 } : { width: 320, height: 220 };
    const title = type === 'frame' ? 'Frame' : 'Note';
    const node: ViewNode = {
      id: newViewId('node'),
      type,
      title,
      x: Math.round(at.x),
      y: Math.round(at.y),
      ...size,
      editable: type === 'frame' ? 'label' : 'content',
      ...(type === 'frame' ? { label: title } : { content: '' }),
    };
    snapshot.nodes.push(node);
    this.sync.enqueue({
      action: 'create',
      type,
      id: node.id,
      title,
      x: node.x,
      y: node.y,
      ...size,
      ...(type === 'frame' ? { data: { label: title } } : { content: '' }),
    });
    this.store.update(state => {
      state.selectedNodes = new Set([node.id]);
      state.selectedEdge = null;
    });
    this.renderer.renderAll(this.store.state);
    if (edit) this.editor.editBody(node.id);
  }

  deleteSelection(): void {
    const state = this.store.state;
    const snapshot = state.snapshot;
    if (!snapshot) return;
    if (state.selectedEdge) {
      const edgeId = state.selectedEdge;
      snapshot.edges = snapshot.edges.filter(edge => edge.id !== edgeId);
      this.sync.enqueue({ action: 'deleteEdge', id: edgeId });
    } else if (state.selectedNodes.size > 0) {
      const ids = new Set(state.selectedNodes);
      snapshot.nodes = snapshot.nodes.filter(node => !ids.has(node.id));
      snapshot.edges = snapshot.edges.filter(edge =>
        !(edge.source.kind === 'node' && ids.has(edge.source.nodeId))
        && !(edge.target.kind === 'node' && ids.has(edge.target.nodeId)));
      this.sync.enqueue(...[...ids].map(id => ({ action: 'delete' as const, id })));
    } else {
      return;
    }
    this.store.update(s => {
      s.selectedNodes = new Set();
      s.selectedEdge = null;
    });
    this.renderer.renderAll(this.store.state);
  }
}
