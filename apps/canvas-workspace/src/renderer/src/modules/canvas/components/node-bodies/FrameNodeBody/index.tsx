import "./index.css";
import { lazy, Suspense } from "react";
import type { CanvasNode, FrameNodeData } from "../../../../../types";
import { NodeTypeBadge } from "../../canvas/CanvasNodeView/NodeTypeBadge";
import { useI18n } from "../../../../../i18n";
import { collectDirectContainerChildren } from "../../../../../utils/frameHierarchy";

/** Maximum direct-child rows shown in a collapsed frame before "+N more". */
const COLLAPSED_SUMMARY_MAX = 6;

/**
 * Only agent-team frames need the team UI, and it pulls in xterm. Load it on
 * demand so plain frames do not fetch the terminal code at startup.
 */
const AgentTeamFrame = lazy(() =>
  import("../../../../agent-team/surface").then((module) => ({ default: module.AgentTeamFrame })),
);

interface Props {
  node: CanvasNode;
  getAllNodes?: () => CanvasNode[];
  onUpdate: (id: string, patch: Partial<CanvasNode>) => void;
  onRemoveNodes?: (ids: string[]) => void;
  rootFolder?: string;
  workspaceId?: string;
  workspaceName?: string;
  readOnly?: boolean;
}

export const FrameNodeBody = ({
  node,
  getAllNodes,
  onUpdate,
  onRemoveNodes,
  rootFolder,
  workspaceId,
  workspaceName,
  readOnly,
}: Props) => {
  const data = node.data as FrameNodeData;
  if (data.agentTeamId) {
    return (
      <Suspense fallback={<div className="frame-body" />}>
        <AgentTeamFrame
          node={node}
          getAllNodes={getAllNodes}
          onUpdate={onUpdate}
          onRemoveNodes={onRemoveNodes}
          rootFolder={rootFolder}
          workspaceId={workspaceId}
          workspaceName={workspaceName}
          readOnly={readOnly}
        />
      </Suspense>
    );
  }
  if (data.childrenCollapsed) {
    return <FrameCollapsedBody node={node} getAllNodes={getAllNodes} />;
  }
  return <div className="frame-body" />;
};

/* ---- Collapsed body: compact summary of hidden children ---- */

const FrameCollapsedBody = ({
  node,
  getAllNodes,
}: {
  node: CanvasNode;
  getAllNodes?: () => CanvasNode[];
}) => {
  const { t } = useI18n();
  const children = getAllNodes
    ? collectDirectContainerChildren(node.id, getAllNodes())
    : [];
  const visible = children.slice(0, COLLAPSED_SUMMARY_MAX);
  const remaining = children.length - visible.length;

  return (
    <div className="frame-body frame-body--collapsed">
      <ul className="frame-children-summary" aria-label={t('canvas.frameChildren.collapsedList')}>
        {visible.map((child) => (
          <li className="frame-children-summary__item" key={child.id}>
            <span className="frame-children-summary__icon">
              <NodeTypeBadge type={child.type} />
            </span>
            <span className="frame-children-summary__title">
              {child.title?.trim() || t('canvas.frameChildren.untitled')}
            </span>
          </li>
        ))}
        {remaining > 0 && (
          <li className="frame-children-summary__more">
            {t('canvas.frameChildren.collapsedMore', { count: remaining })}
          </li>
        )}
      </ul>
    </div>
  );
};
