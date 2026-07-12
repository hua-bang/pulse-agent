import { Suspense } from 'react';
import type { WorkspaceEntry } from '../../hooks/useWorkspaces';
import type { KnowledgeNodeSelection } from '../../types';
import { PulseRouterView } from '../router';
import { NodeDetailPageLazy, NodesPageLazy } from '../AppLazyBoundaries';
import type { NodesAiContext } from './knowledgeAiContext';

interface Props {
  enabled: boolean;
  workspaces: WorkspaceEntry[];
  detailNode: KnowledgeNodeSelection | null;
  onBack: () => void;
  onAskAi: (context: NodesAiContext, action: 'chat' | 'summarize') => void;
}

/** Keeps the application shell focused on routing, not Nodes route composition. */
export const NodesRouteViews = ({
  enabled,
  workspaces,
  detailNode,
  onBack,
  onAskAi,
}: Props) => {
  if (!enabled) return null;
  return (
    <>
      <PulseRouterView name="nodes" keepAlive>
        <Suspense fallback={null}>
          <NodesPageLazy workspaces={workspaces} onAskAi={onAskAi} />
        </Suspense>
      </PulseRouterView>
      <PulseRouterView name="node-detail">
        <Suspense fallback={null}>
          <NodeDetailPageLazy workspaceId={detailNode?.workspaceId ?? ''} nodeId={detailNode?.nodeId ?? null} workspaces={workspaces} onBack={onBack} />
        </Suspense>
      </PulseRouterView>
    </>
  );
};
