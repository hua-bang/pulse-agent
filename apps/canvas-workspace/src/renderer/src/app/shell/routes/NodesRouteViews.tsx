import { Suspense, useState } from 'react';
import type { WorkspaceEntry } from '../../../shared/workspaces';
import type { KnowledgeNodeSelection } from '../../../types';
import { PulseRouterView, usePulseRouterContext } from '../router';
import { NodeDetailPageLazy, NodesPageLazy } from '../AppLazyBoundaries';
import type { NodesAiContext } from '../../../modules/workspace-nodes';

interface Props {
  enabled: boolean;
  workspaces: WorkspaceEntry[];
  detailNode: KnowledgeNodeSelection | null;
  onBack: () => void;
  onAskAi: (context: NodesAiContext, action: 'chat' | 'summarize') => void;
  onAskAiAboutDetail: () => void;
  onOpenGraph?: () => void;
}

/** Keeps the application shell focused on routing, not Nodes route composition. */
export const NodesRouteViews = ({
  enabled,
  workspaces,
  detailNode,
  onBack,
  onAskAi,
  onAskAiAboutDetail,
  onOpenGraph,
}: Props) => {
  const { activeKey } = usePulseRouterContext();
  // keepAlive renders hidden children, so gate on the first visit: otherwise the
  // Nodes chunk loads and mounts at startup, ahead of the first canvas paint.
  const [visited, setVisited] = useState(activeKey === 'nodes');
  if (activeKey === 'nodes' && !visited) setVisited(true);
  if (!enabled) return null;
  return (
    <>
      {visited && (
        <PulseRouterView name="nodes" keepAlive>
          <Suspense fallback={null}>
            <NodesPageLazy workspaces={workspaces} onAskAi={onAskAi} onOpenGraph={onOpenGraph} />
          </Suspense>
        </PulseRouterView>
      )}
      <PulseRouterView name="node-detail">
        <Suspense fallback={null}>
          <NodeDetailPageLazy workspaceId={detailNode?.workspaceId ?? ''} nodeId={detailNode?.nodeId ?? null} onBack={onBack} onAskAi={onAskAiAboutDetail} />
        </Suspense>
      </PulseRouterView>
    </>
  );
};
