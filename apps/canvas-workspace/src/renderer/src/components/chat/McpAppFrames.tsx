import type { ToolCallStatus } from './types';
import { McpAppFrame } from '../mcp-apps/McpAppFrame';
import { useMcpAppsHost } from '../mcp-apps/McpAppsProvider';

export const McpAppFrames = ({
  tools,
  instanceScope,
}: {
  tools: ToolCallStatus[];
  instanceScope: string;
}) => {
  const host = useMcpAppsHost();
  if (!host) return null;
  return <>{tools.filter(tool => tool.status === 'succeeded' && tool.mcpApp).map(tool => (
    <McpAppFrame
      key={`mcp-app-${tool.toolCallId ?? tool.id}`}
      instanceId={`${instanceScope}:${tool.toolCallId ?? tool.id}`}
      app={tool.mcpApp!}
      args={tool.args}
      fallbackResult={tool.result}
      scope={host.scope}
    />
  ))}</>;
};
