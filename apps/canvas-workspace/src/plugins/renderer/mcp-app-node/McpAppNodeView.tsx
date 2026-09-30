import { useCallback, useEffect, useMemo, useState } from 'react';
import { McpAppFrame } from '../../../renderer/src/modules/mcp-apps';
import { Button } from '../../../renderer/src/components/ui';
import { useI18n } from '../../../renderer/src/i18n';
import type { AgentChatMcpApp, AgentScope } from '../../../renderer/src/types';
import { parseMcpAppNodeBinding } from '../../../shared/mcp-app-node';
import type { PluginNodeViewProps } from '../../types';

type OpenState =
  | { status: 'loading' }
  | { status: 'error'; error: string }
  | { status: 'ready'; result: unknown };

export const McpAppNodeView = ({ node, workspaceId }: PluginNodeViewProps) => {
  const { t } = useI18n();
  const binding = parseMcpAppNodeBinding((node.data as { payload?: unknown }).payload);
  const serverName = binding?.serverName;
  const toolName = binding?.toolName;
  const resourceUri = binding?.resourceUri;
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<OpenState>({ status: 'loading' });
  const scope = useMemo<AgentScope>(
    () => (workspaceId ? { kind: 'workspace', workspaceId } : { kind: 'global' }),
    [workspaceId],
  );
  const hostContextExtras = useMemo(() => ({ 'pulse/node': { nodeId: node.id } }), [node.id]);
  const nodeContextTarget = useMemo(() => (
    workspaceId && serverName && toolName && resourceUri
      ? { workspaceId, nodeId: node.id, serverName, toolName, resourceUri }
      : undefined
  ), [workspaceId, node.id, serverName, toolName, resourceUri]);

  useEffect(() => {
    if (!serverName || !toolName) return;
    let cancelled = false;
    setState({ status: 'loading' });
    // Entrypoints open with `{}`, matching OpenAI global/thread entrypoints.
    void window.canvasWorkspace.agent.mcpApps
      .openEntrypoint(scope, serverName, toolName)
      .then((result) => {
        if (cancelled) return;
        setState(result.ok
          ? { status: 'ready', result: result.value }
          : { status: 'error', error: result.error ?? 'Failed to open MCP App' });
      })
      .catch((error: unknown) => {
        if (!cancelled) setState({ status: 'error', error: String(error) });
      });
    return () => { cancelled = true; };
  }, [attempt, scope, serverName, toolName]);

  const app = useMemo<AgentChatMcpApp | undefined>(() => (
    serverName && toolName && resourceUri && state.status === 'ready'
      ? { serverName, toolName, resourceUri, result: state.result }
      : undefined
  ), [resourceUri, serverName, state, toolName]);
  const retry = useCallback(() => setAttempt(value => value + 1), []);

  if (!binding) {
    return <div className="mcp-app-node mcp-app-node--status">{t('mcpApp.node.invalid')}</div>;
  }
  if (state.status === 'error') {
    return (
      <div className="mcp-app-node mcp-app-node--status">
        <span>{state.error}</span>
        <Button size="sm" onClick={retry}>{t('mcpApp.node.retry')}</Button>
      </div>
    );
  }
  if (!app) {
    return (
      <div className="mcp-app-node mcp-app-node--status">
        {t('mcpApp.node.opening', { title: binding.title })}
      </div>
    );
  }
  return (
    <div className="mcp-app-node">
      <McpAppFrame
        embedded
        instanceId={`canvas-node:${node.id}`}
        app={app}
        args={{}}
        scope={scope}
        hostContextExtras={hostContextExtras}
        nodeContextTarget={nodeContextTarget}
      />
    </div>
  );
};
