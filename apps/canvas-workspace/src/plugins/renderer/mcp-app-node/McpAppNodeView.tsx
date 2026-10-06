import { useMemo } from 'react';
import { McpAppFrame, useMcpAppEntrypoint } from '../../../renderer/src/modules/mcp-apps';
import { Button } from '../../../renderer/src/components/ui';
import { useI18n } from '../../../renderer/src/i18n';
import type { AgentScope } from '../../../renderer/src/types';
import { parseMcpAppNodeBinding } from '../../../shared/mcp-app-node';
import type { PluginNodeViewProps } from '../../types';

export const McpAppNodeView = ({ node, workspaceId }: PluginNodeViewProps) => {
  const { t } = useI18n();
  const binding = parseMcpAppNodeBinding((node.data as { payload?: unknown }).payload);
  const serverName = binding?.serverName;
  const toolName = binding?.toolName;
  const resourceUri = binding?.resourceUri;
  const scope = useMemo<AgentScope>(
    () => (workspaceId ? { kind: 'workspace', workspaceId } : { kind: 'global' }),
    [workspaceId],
  );
  const target = useMemo(() => (
    serverName && toolName && resourceUri ? { serverName, toolName, resourceUri } : undefined
  ), [resourceUri, serverName, toolName]);
  const { app, error, retry } = useMcpAppEntrypoint(scope, target);
  const hostContextExtras = useMemo(() => ({ 'pulse/node': { nodeId: node.id } }), [node.id]);
  const nodeContextTarget = useMemo(() => (
    workspaceId && target ? { workspaceId, nodeId: node.id, ...target } : undefined
  ), [workspaceId, node.id, target]);

  if (!binding) {
    return <div className="mcp-app-node mcp-app-node--status">{t('mcpApp.node.invalid')}</div>;
  }
  if (error) {
    return (
      <div className="mcp-app-node mcp-app-node--status">
        <span>{error}</span>
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
