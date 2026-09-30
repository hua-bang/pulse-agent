import type { ViewState } from './state';

export type ToolbarAction =
  | 'note'
  | 'frame'
  | 'connect'
  | 'delete'
  | 'zoom-in'
  | 'zoom-out'
  | 'fit'
  | 'refresh'
  | 'display-mode';

export interface ToolbarRefs {
  root: HTMLElement;
  workspace: HTMLSelectElement;
  status: HTMLElement;
  zoom: HTMLElement;
  connect: HTMLButtonElement;
  remove: HTMLButtonElement;
  displayMode: HTMLButtonElement;
}

export function toolbarRefs(root: HTMLElement): ToolbarRefs {
  const q = <T extends Element>(selector: string) => root.querySelector<T>(selector)!;
  return {
    root,
    workspace: q<HTMLSelectElement>('.pc-workspace'),
    status: q<HTMLElement>('.pc-status'),
    zoom: q<HTMLElement>('.pc-zoom'),
    connect: q<HTMLButtonElement>('[data-action="connect"]'),
    remove: q<HTMLButtonElement>('[data-action="delete"]'),
    displayMode: q<HTMLButtonElement>('[data-action="display-mode"]'),
  };
}

const STATUS_TEXT: Record<ViewState['status']['kind'], string> = {
  idle: '',
  loading: 'Loading…',
  saving: 'Saving…',
  saved: 'Saved',
  error: 'Error',
};

export function renderToolbar(refs: ToolbarRefs, state: ViewState): void {
  const currentId = state.snapshot?.workspaceId ?? '';
  const options = state.workspaces.map(workspace => {
    const option = document.createElement('option');
    option.value = workspace.id;
    option.textContent = workspace.name + (workspace.active ? '  •' : '');
    return option;
  });
  if (!currentId) {
    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = 'Choose a workspace…';
    options.unshift(placeholder);
  }
  const signature = options.map(option => `${option.value}=${option.textContent}`).join('|');
  if (refs.workspace.dataset.signature !== signature) {
    refs.workspace.replaceChildren(...options);
    refs.workspace.dataset.signature = signature;
  }
  refs.workspace.value = currentId;

  const { kind, message } = state.status;
  refs.status.textContent = message ?? STATUS_TEXT[kind];
  refs.status.dataset.kind = kind;
  refs.status.title = message ?? '';
  refs.zoom.textContent = `${Math.round(state.transform.scale * 100)}%`;

  refs.connect.classList.toggle('pc-active', state.connectMode);
  refs.connect.textContent = state.connectMode
    ? (state.connectFrom ? 'Pick target' : 'Pick source')
    : 'Connect';
  refs.remove.disabled = state.selectedNodes.size === 0 && !state.selectedEdge;

  const next = state.displayMode === 'fullscreen' ? 'inline' : 'fullscreen';
  refs.displayMode.hidden = !state.availableDisplayModes.includes(next);
  refs.displayMode.textContent = next === 'fullscreen' ? 'Expand' : 'Collapse';

  for (const button of refs.root.querySelectorAll<HTMLButtonElement>('[data-needs-canvas]')) {
    button.disabled = !state.snapshot;
  }
}

export const TOOLBAR_HTML = `
  <select class="pc-workspace" aria-label="Workspace"></select>
  <div class="pc-group">
    <button type="button" data-action="note" data-needs-canvas title="New note (or double-click the canvas)">+ Note</button>
    <button type="button" data-action="frame" data-needs-canvas title="New frame">+ Frame</button>
    <button type="button" data-action="connect" data-needs-canvas title="Connect two nodes">Connect</button>
    <button type="button" data-action="delete" title="Delete selection (Del)">Delete</button>
  </div>
  <div class="pc-group">
    <button type="button" data-action="zoom-out" data-needs-canvas title="Zoom out">−</button>
    <span class="pc-zoom">100%</span>
    <button type="button" data-action="zoom-in" data-needs-canvas title="Zoom in">+</button>
    <button type="button" data-action="fit" data-needs-canvas title="Fit to content">Fit</button>
  </div>
  <span class="pc-status" role="status"></span>
  <div class="pc-group pc-end">
    <button type="button" data-action="refresh" title="Reload from disk">Refresh</button>
    <button type="button" data-action="display-mode" hidden>Expand</button>
  </div>
`;
