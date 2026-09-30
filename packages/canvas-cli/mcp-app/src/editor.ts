import type { ViewNode } from '../../src/mcp/view-types';
import type { Renderer } from './render';
import { isContainer } from './render';
import type { ViewStore } from './state';
import type { SyncEngine } from './sync';

/**
 * In-place editing: node bodies become a textarea, titles an input. Edits
 * commit on blur or Mod+Enter / Enter and cancel on Escape. While an editor
 * is open the view counts as interacting, so sync never reloads under it.
 */
export class NodeEditor {
  private active: { close: (commit: boolean) => void } | null = null;

  constructor(
    private readonly store: ViewStore,
    private readonly renderer: Renderer,
    private readonly sync: SyncEngine,
  ) {}

  get editing(): boolean {
    return this.active !== null;
  }

  closeActive(commit = true): void {
    this.active?.close(commit);
  }

  editBody(nodeId: string): void {
    const node = this.store.node(nodeId);
    const element = this.renderer.nodeElement(nodeId);
    if (!node || !element) return;
    if (isContainer(node)) {
      this.editTitle(nodeId);
      return;
    }
    if (node.editable !== 'content') return;
    const body = element.querySelector<HTMLElement>('[data-role="body"]');
    if (!body) return;
    this.closeActive();

    const textarea = document.createElement('textarea');
    textarea.className = 'pc-editor';
    textarea.value = node.content ?? '';
    textarea.spellcheck = true;
    body.replaceChildren(textarea);
    this.open(textarea, commit => {
      const value = textarea.value;
      if (commit && value !== (node.content ?? '')) {
        node.content = value;
        this.sync.enqueue({ action: 'update', id: node.id, content: value });
      }
    }, event => (event.metaKey || event.ctrlKey) && event.key === 'Enter');
  }

  editTitle(nodeId: string): void {
    const node = this.store.node(nodeId);
    const element = this.renderer.nodeElement(nodeId);
    const title = element?.querySelector<HTMLElement>('.pc-node-title');
    if (!node || !title) return;
    this.closeActive();

    const container = isContainer(node);
    const current = container ? (node.label || node.title) : node.title;
    const input = document.createElement('input');
    input.className = 'pc-title-editor';
    input.value = current;
    title.replaceChildren(input);
    this.open(input, commit => {
      const value = input.value.trim();
      if (!commit || value === current) return;
      this.commitTitle(node, value, container);
    }, event => event.key === 'Enter');
  }

  private commitTitle(node: ViewNode, value: string, container: boolean): void {
    if (container) {
      node.label = value;
      this.sync.enqueue({ action: 'update', id: node.id, content: JSON.stringify({ label: value }) });
    } else if (value) {
      node.title = value;
      this.sync.enqueue({ action: 'update', id: node.id, title: value });
    }
  }

  private open(
    field: HTMLTextAreaElement | HTMLInputElement,
    apply: (commit: boolean) => void,
    isCommitKey: (event: KeyboardEvent) => boolean,
  ): void {
    let closed = false;
    const close = (commit: boolean) => {
      if (closed) return;
      closed = true;
      this.active = null;
      apply(commit);
      this.store.update(state => {
        state.interacting = false;
      });
      this.renderer.renderAll(this.store.state);
    };
    this.active = { close };
    this.store.state.interacting = true;
    for (const type of ['pointerdown', 'dblclick', 'wheel'] as const) {
      field.addEventListener(type, event => event.stopPropagation());
    }
    (field as HTMLElement).addEventListener('keydown', (event: KeyboardEvent) => {
      event.stopPropagation();
      if (event.key === 'Escape') close(false);
      else if (isCommitKey(event)) {
        event.preventDefault();
        close(true);
      }
    });
    field.addEventListener('blur', () => close(true));
    field.focus();
    if (field instanceof HTMLInputElement) field.select();
  }
}
