import {
  App,
  applyDocumentTheme,
  applyHostStyleVariables,
  type McpUiHostContext,
} from '@modelcontextprotocol/ext-apps';
import { errorMessage } from './bridge';
import { NodeEditor } from './editor';
import { fitTransform, zoomAt } from './geometry';
import { Interactions } from './interactions';
import { describeViewForModel } from './model-context';
import { Renderer } from './render';
import { ViewStore, type DisplayMode } from './state';
import { SyncEngine } from './sync';
import { renderToolbar, TOOLBAR_HTML, toolbarRefs, type ToolbarAction } from './toolbar';

const INLINE_HEIGHT = 600;
const LOAD_FALLBACK_MS = 1_500;
const MODEL_CONTEXT_DEBOUNCE_MS = 600;

const root = document.getElementById('app')!;
root.innerHTML = `
  <header class="pc-toolbar">${TOOLBAR_HTML}</header>
  <main class="pc-viewport">
    <div class="pc-world">
      <svg class="pc-edges" aria-hidden="true"></svg>
      <div class="pc-nodes"></div>
      <div class="pc-edge-labels"></div>
    </div>
    <div class="pc-empty" hidden>This canvas is empty. Double-click to add a note.</div>
  </main>
`;

const viewport = root.querySelector<HTMLElement>('.pc-viewport')!;
const toolbar = toolbarRefs(root.querySelector<HTMLElement>('.pc-toolbar')!);
const app = new App({ name: 'Pulse Canvas', version: '1.0.0' }, {}, { autoResize: false });
const store = new ViewStore();
const renderer = new Renderer({
  viewport,
  world: root.querySelector<HTMLElement>('.pc-world')!,
  edges: root.querySelector<SVGSVGElement>('.pc-edges')!,
  nodes: root.querySelector<HTMLElement>('.pc-nodes')!,
  labels: root.querySelector<HTMLElement>('.pc-edge-labels')!,
  empty: root.querySelector<HTMLElement>('.pc-empty')!,
}, store);
const sync = new SyncEngine(app, store, message => void app.sendLog({ level: 'warning', data: message }).catch(() => undefined));
const editor = new NodeEditor(store, renderer, sync);
const interactions = new Interactions(viewport, store, renderer, sync, editor);

// ─── Rendering and model context ────────────────────────────────────

let renderedSnapshot: unknown = null;
let fittedWorkspace: string | null = null;
let modelContextKey = '';
let modelContextTimer: ReturnType<typeof setTimeout> | undefined;

function fitToContent(): void {
  const nodes = store.state.snapshot?.nodes ?? [];
  const rect = viewport.getBoundingClientRect();
  store.state.transform = fitTransform(nodes, rect);
}

function publishModelContext(): void {
  const snapshot = store.state.snapshot;
  if (!snapshot || !app.getHostCapabilities()?.updateModelContext) return;
  const selected = [...store.state.selectedNodes].sort();
  const key = `${snapshot.workspaceId}|${snapshot.version}|${selected.join(',')}`;
  if (key === modelContextKey) return;
  clearTimeout(modelContextTimer);
  modelContextTimer = setTimeout(() => {
    modelContextKey = key;
    const text = describeViewForModel(snapshot, selected);
    void app.updateModelContext({ content: [{ type: 'text', text }] }).catch(() => undefined);
  }, MODEL_CONTEXT_DEBOUNCE_MS);
}

store.subscribe(state => {
  if (state.snapshot !== renderedSnapshot) {
    renderedSnapshot = state.snapshot;
    if (state.snapshot && state.snapshot.workspaceId !== fittedWorkspace) {
      fittedWorkspace = state.snapshot.workspaceId;
      fitToContent();
    }
    renderer.renderAll(state);
  } else {
    renderer.applyTransform(state);
  }
  renderToolbar(toolbar, state);
  publishModelContext();
});

// ─── Toolbar ────────────────────────────────────────────────────────

function zoomBy(factor: number): void {
  const rect = viewport.getBoundingClientRect();
  store.update(state => {
    state.transform = zoomAt(state.transform, factor, { x: rect.width / 2, y: rect.height / 2 });
  });
}

async function toggleDisplayMode(): Promise<void> {
  const mode: DisplayMode = store.state.displayMode === 'fullscreen' ? 'inline' : 'fullscreen';
  try {
    const result = await app.requestDisplayMode({ mode });
    applyDisplayMode(result.mode as DisplayMode);
  } catch (err) {
    store.setStatus('error', errorMessage(err));
  }
}

const actions: Record<ToolbarAction, () => void> = {
  note: () => {
    const center = interactions.viewportCenter();
    interactions.createNode('file', { x: center.x - 160, y: center.y - 110 }, true);
  },
  frame: () => {
    const center = interactions.viewportCenter();
    interactions.createNode('frame', { x: center.x - 360, y: center.y - 240 });
  },
  connect: () => store.update(state => {
    state.connectMode = !state.connectMode;
    state.connectFrom = null;
  }),
  delete: () => interactions.deleteSelection(),
  'zoom-in': () => zoomBy(1.2),
  'zoom-out': () => zoomBy(1 / 1.2),
  fit: () => store.update(fitToContent),
  refresh: () => void sync.flush().then(() => sync.load(store.state.snapshot?.workspaceId)),
  'display-mode': () => void toggleDisplayMode(),
};

toolbar.root.addEventListener('click', event => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-action]');
  const action = button?.dataset.action as ToolbarAction | undefined;
  if (action && !button!.disabled) actions[action]();
});

toolbar.workspace.addEventListener('change', () => {
  const workspaceId = toolbar.workspace.value;
  if (!workspaceId || workspaceId === store.state.snapshot?.workspaceId) return;
  editor.closeActive();
  void sync.flush().then(() => sync.load(workspaceId));
});

// Links in node previews open through the host, never inside the sandbox.
viewport.addEventListener('click', event => {
  const link = (event.target as HTMLElement).closest<HTMLElement>('a[data-href]');
  if (!link) return;
  event.preventDefault();
  const url = link.dataset.href!;
  if (/^https?:\/\//.test(url)) void app.openLink({ url }).catch(() => undefined);
});

// ─── Host context ───────────────────────────────────────────────────

function applyDisplayMode(mode: DisplayMode | undefined): void {
  if (!mode) return;
  document.documentElement.dataset.displayMode = mode;
  store.update(state => {
    state.displayMode = mode;
  });
  if (mode === 'inline') void app.sendSizeChanged({ height: INLINE_HEIGHT }).catch(() => undefined);
}

function applyHostContext(context: Partial<McpUiHostContext> | undefined): void {
  if (!context) return;
  if (context.theme) applyDocumentTheme(context.theme);
  if (context.styles?.variables) applyHostStyleVariables(context.styles.variables);
  if (context.availableDisplayModes) {
    const modes = context.availableDisplayModes as DisplayMode[];
    store.update(state => {
      state.availableDisplayModes = modes;
    });
  }
  applyDisplayMode(context.displayMode as DisplayMode | undefined);
}

// ─── Lifecycle ──────────────────────────────────────────────────────

let loaded = false;

function loadOnce(workspaceId?: string): void {
  if (loaded) return;
  loaded = true;
  void sync.load(workspaceId).then(() => sync.startPolling());
}

app.ontoolinput = params => {
  const workspaceId = params.arguments?.workspaceId;
  if (typeof workspaceId === 'string' && workspaceId) loadOnce(workspaceId);
};

app.ontoolresult = result => {
  const opened = result.structuredContent as { workspaceId?: string | null } | undefined;
  if (opened?.workspaceId) {
    if (!loaded) loadOnce(opened.workspaceId);
    // A slow tool result may name another workspace than the fallback load picked.
    else if (store.state.snapshot && store.state.snapshot.workspaceId !== opened.workspaceId) {
      void sync.flush().then(() => sync.load(opened.workspaceId!));
    }
  } else if (!loaded && opened && opened.workspaceId === null) {
    loaded = true;
    void sync.showPicker().then(() => sync.startPolling());
  }
};

app.onhostcontextchanged = context => applyHostContext(context);

app.onteardown = async () => {
  editor.closeActive();
  sync.stopPolling();
  await sync.flush();
  return {};
};

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') {
    editor.closeActive();
    void sync.flush();
  }
});

interactions.attach();
renderToolbar(toolbar, store.state);

app.connect()
  .then(() => {
    applyHostContext(app.getHostContext());
    // Hosts that open the view without replaying the tool result still get a canvas.
    setTimeout(() => loadOnce(), LOAD_FALLBACK_MS);
  })
  .catch(err => store.setStatus('error', `Could not connect to the host: ${errorMessage(err)}`));
