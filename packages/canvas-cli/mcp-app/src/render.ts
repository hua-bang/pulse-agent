import type { ViewEdge, ViewEdgeEndpoint, ViewNode } from '../../src/mcp/view-types';
import { arrowPoints, edgeGeometry, type EdgeEnd } from './geometry';
import { renderMarkdown } from './markdown';
import type { ViewState, ViewStore } from './state';

const SVG_NS = 'http://www.w3.org/2000/svg';
const CONTAINER_TYPES = new Set(['frame', 'group']);

/** Live-only node types: the view shows a card, the app owns the real surface. */
const LIVE_TYPE_LABELS: Record<string, string> = {
  terminal: 'Terminal',
  agent: 'Agent',
  iframe: 'Web page',
  'dynamic-app': 'Dynamic app',
  plugin: 'Plugin',
  image: 'Image',
  reference: 'Reference',
};

export interface RenderRefs {
  viewport: HTMLElement;
  world: HTMLElement;
  edges: SVGSVGElement;
  nodes: HTMLElement;
  labels: HTMLElement;
  empty: HTMLElement;
}

export const isContainer = (node: Pick<ViewNode, 'type'>): boolean => CONTAINER_TYPES.has(node.type);

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

function svg<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string>): SVGElementTagNameMap[K] {
  const element = document.createElementNS(SVG_NS, tag);
  for (const [key, value] of Object.entries(attrs)) element.setAttribute(key, value);
  return element;
}

function renderBody(node: ViewNode): HTMLElement {
  const body = el('div', 'pc-node-body');
  body.dataset.role = 'body';
  if (node.type === 'file' || node.type === 'text') {
    const markdown = el('div', 'pc-markdown');
    markdown.innerHTML = node.content ? renderMarkdown(node.content) : '<p class="pc-muted">Empty — double-click to write</p>';
    body.append(markdown);
    if (node.contentTruncated) body.append(el('div', 'pc-notice', 'Preview truncated. Edit this node in Pulse Canvas.'));
  } else if (node.type === 'mindmap') {
    body.append(el('pre', 'pc-outline', node.outline || '(empty mindmap)'));
  } else if (node.type === 'shape') {
    body.classList.add('pc-shape-body');
    if (node.color) body.style.background = node.color;
    body.append(el('div', 'pc-shape-text', node.content ?? ''));
  } else if (!isContainer(node)) {
    const card = el('div', 'pc-live-card');
    card.append(el('div', 'pc-live-kind', LIVE_TYPE_LABELS[node.type] ?? node.type));
    if (node.meta) card.append(el('div', 'pc-live-meta', node.meta));
    card.append(el('div', 'pc-muted', 'Open in Pulse Canvas to use this node.'));
    body.append(card);
  }
  return body;
}

export function createNodeElement(node: ViewNode, selected: boolean): HTMLElement {
  const container = isContainer(node);
  const element = el('div', `pc-node pc-type-${node.type.replace(/[^a-z0-9-]/gi, '')}`);
  element.dataset.nodeId = node.id;
  if (container) element.classList.add('pc-container');
  if (selected) element.classList.add('pc-selected');
  if (node.color && container) {
    element.style.borderColor = node.color;
    element.style.setProperty('--pc-frame-color', node.color);
  }

  const header = el('div', 'pc-node-header');
  header.dataset.role = 'header';
  header.append(el('span', 'pc-node-title', container ? (node.label || node.title) : node.title));
  if (!container) header.append(el('span', 'pc-node-badge', node.type));
  element.append(header, renderBody(node));

  const resize = el('div', 'pc-resize');
  resize.dataset.role = 'resize';
  element.append(resize);
  positionNode(element, node);
  return element;
}

export function positionNode(element: HTMLElement, node: ViewNode): void {
  element.style.left = `${node.x}px`;
  element.style.top = `${node.y}px`;
  element.style.width = `${node.width}px`;
  element.style.height = `${node.height}px`;
}

function endpointEnd(endpoint: ViewEdgeEndpoint, nodes: Map<string, ViewNode>): EdgeEnd | null {
  if (endpoint.kind === 'point') return { x: endpoint.x, y: endpoint.y };
  return nodes.get(endpoint.nodeId) ?? null;
}

const DASHES: Record<string, string> = { dashed: '10 8', dotted: '2 8' };

export class Renderer {
  private nodeElements = new Map<string, HTMLElement>();

  constructor(private readonly refs: RenderRefs, private readonly store: ViewStore) {}

  renderAll(state: ViewState): void {
    this.renderNodes(state);
    this.renderEdges(state);
    this.applyTransform(state);
  }

  applyTransform(state: ViewState): void {
    const { x, y, scale } = state.transform;
    this.refs.world.style.transform = `translate(${x}px, ${y}px) scale(${scale})`;
    this.refs.viewport.style.setProperty('--pc-grid-size', `${24 * scale}px`);
    this.refs.viewport.style.backgroundPosition = `${x}px ${y}px`;
  }

  renderNodes(state: ViewState): void {
    const nodes = state.snapshot?.nodes ?? [];
    this.refs.nodes.replaceChildren();
    this.nodeElements.clear();
    // Containers paint first so they stay behind the nodes they hold.
    const ordered = [...nodes.filter(isContainer), ...nodes.filter(node => !isContainer(node))];
    for (const node of ordered) {
      const element = createNodeElement(node, state.selectedNodes.has(node.id));
      if (state.connectFrom === node.id) element.classList.add('pc-connect-source');
      this.nodeElements.set(node.id, element);
      this.refs.nodes.append(element);
    }
    this.refs.empty.hidden = !state.snapshot || nodes.length > 0;
  }

  nodeElement(id: string): HTMLElement | undefined {
    return this.nodeElements.get(id);
  }

  /** Cheap per-frame update while dragging or resizing. */
  moveNodes(ids: Iterable<string>): void {
    for (const id of ids) {
      const node = this.store.node(id);
      const element = this.nodeElements.get(id);
      if (node && element) positionNode(element, node);
    }
    this.renderEdges(this.store.state);
  }

  renderSelection(state: ViewState): void {
    for (const [id, element] of this.nodeElements) {
      element.classList.toggle('pc-selected', state.selectedNodes.has(id));
      element.classList.toggle('pc-connect-source', state.connectFrom === id);
    }
    this.renderEdges(state);
  }

  renderEdges(state: ViewState): void {
    const snapshot = state.snapshot;
    this.refs.edges.replaceChildren();
    this.refs.labels.replaceChildren();
    if (!snapshot) return;
    const nodes = new Map(snapshot.nodes.map(node => [node.id, node]));
    for (const edge of snapshot.edges) this.renderEdge(edge, nodes, state.selectedEdge === edge.id);
  }

  private renderEdge(edge: ViewEdge, nodes: Map<string, ViewNode>, selected: boolean): void {
    const source = endpointEnd(edge.source, nodes);
    const target = endpointEnd(edge.target, nodes);
    if (!source || !target) return;
    const { from, to, mid } = edgeGeometry(source, target);
    const width = Math.min(Math.max(edge.width ?? 2, 1), 12);
    const group = svg('g', { class: `pc-edge${selected ? ' pc-selected' : ''}`, 'data-edge-id': edge.id });
    if (edge.color) group.style.setProperty('--pc-edge-color', edge.color);
    const d = `M ${from.x} ${from.y} L ${to.x} ${to.y}`;
    group.append(svg('path', { d, class: 'pc-edge-hit' }));
    const line = svg('path', { d, class: 'pc-edge-line', 'stroke-width': String(width) });
    if (edge.style && DASHES[edge.style]) line.setAttribute('stroke-dasharray', DASHES[edge.style]);
    group.append(line);
    const arrowSize = 8 + width * 2;
    if ((edge.arrowHead ?? 'triangle') !== 'none') {
      group.append(svg('polygon', { points: arrowPoints(from, to, arrowSize), class: 'pc-edge-arrow' }));
    }
    if (edge.arrowTail && edge.arrowTail !== 'none') {
      group.append(svg('polygon', { points: arrowPoints(to, from, arrowSize), class: 'pc-edge-arrow' }));
    }
    this.refs.edges.append(group);

    if (edge.label) {
      const label = el('div', `pc-edge-label${selected ? ' pc-selected' : ''}`, edge.label);
      label.dataset.edgeId = edge.id;
      label.style.left = `${mid.x}px`;
      label.style.top = `${mid.y}px`;
      this.refs.labels.append(label);
    }
  }
}
