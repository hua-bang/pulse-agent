import { createRoot } from 'react-dom/client';
import {
  App,
  applyDocumentTheme,
  applyHostStyleVariables,
  type McpUiHostContext,
} from '@modelcontextprotocol/ext-apps';
import { ensureUsableLocalStorage } from './internal/sandboxStorage';
import { NodeViewHost } from './internal/nodeViewHost';
import { describeNodeForModel } from './internal/modelContext';
import { NodeView } from './components/NodeView';
import { I18nProvider } from '../../i18n';
import '../../styles.css';

/**
 * MCP App entry served by `pulse-canvas mcp` as `ui://pulse-canvas/node.html`:
 * one canvas node rendered with the app's own node bodies inside an agent
 * host's conversation (Codex, ChatGPT, Claude, or Pulse Canvas itself).
 */
ensureUsableLocalStorage();

const LOAD_FALLBACK_MS = 1_500;
const MODEL_CONTEXT_DEBOUNCE_MS = 800;

const app = new App({ name: 'Pulse Canvas node', version: '1.0.0' }, {}, { autoResize: true });
const host = new NodeViewHost(app);
let opened = false;

function open(target: { workspaceId?: string; nodeId?: string }): void {
  opened = true;
  void host.open(target);
}

function applyHostContext(context: Partial<McpUiHostContext> | undefined): void {
  if (context?.theme) applyDocumentTheme(context.theme);
  if (context?.styles?.variables) applyHostStyleVariables(context.styles.variables);
}

app.ontoolinput = params => {
  const args = params.arguments ?? {};
  const nodeId = typeof args.nodeId === 'string' ? args.nodeId : undefined;
  const workspaceId = typeof args.workspaceId === 'string' ? args.workspaceId : undefined;
  if (!opened && nodeId) open({ workspaceId, nodeId });
};

app.ontoolresult = result => {
  const target = result.structuredContent as { workspaceId?: string | null; nodeId?: string | null } | undefined;
  if (!target) return;
  const next = { workspaceId: target.workspaceId ?? undefined, nodeId: target.nodeId ?? undefined };
  const current = host.snapshot.node;
  if (!opened || (next.nodeId && current && current.id !== next.nodeId)) open(next);
};

app.onhostcontextchanged = context => applyHostContext(context);

app.onteardown = async () => {
  host.stop();
  await host.flush();
  return {};
};

// Keep the model's picture of the node current as the user edits it.
let contextKey = '';
let contextTimer: ReturnType<typeof setTimeout> | undefined;
host.subscribe(state => {
  if (!state.node || !app.getHostCapabilities()?.updateModelContext) return;
  const text = describeNodeForModel(state.node, { id: state.workspaceId, name: state.workspaceName });
  if (text === contextKey) return;
  clearTimeout(contextTimer);
  contextTimer = setTimeout(() => {
    contextKey = text;
    void app.updateModelContext({ content: [{ type: 'text', text }] }).catch(() => undefined);
  }, MODEL_CONTEXT_DEBOUNCE_MS);
});

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') void host.flush();
});

createRoot(document.getElementById('root')!).render(
  <I18nProvider>
    <NodeView host={host} />
  </I18nProvider>,
);

app.connect()
  .then(() => {
    applyHostContext(app.getHostContext());
    // Hosts that never replay the opening tool call still get a picker.
    setTimeout(() => {
      if (!opened) open({});
    }, LOAD_FALLBACK_MS);
  })
  .catch(() => undefined);
