import { lazy, Suspense } from 'react';
import type { ToolCallStatus } from './types';

const McpAppFrames = lazy(() => import('./McpAppFrame').then((module) => ({
  default: module.McpAppFrames,
})));

export const McpAppFramesLazy = ({
  tools,
  instanceScope,
}: {
  tools: ToolCallStatus[];
  instanceScope: string;
}) => {
  if (!tools.some(tool => tool.status === 'succeeded' && tool.mcpApp)) return null;
  return (
    <Suspense fallback={null}>
      <McpAppFrames tools={tools} instanceScope={instanceScope} />
    </Suspense>
  );
};
