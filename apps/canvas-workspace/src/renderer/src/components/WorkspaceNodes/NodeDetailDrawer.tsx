import { useCallback, useEffect, useRef, useState } from 'react';
import type { KnowledgeTagDefinition } from '../../types';
import { NodeDetailPanel } from './NodeDetailPanel';
import { useKnowledgeTags, useWorkspaceNode } from './useWorkspaceNodes';
import { useI18n } from '../../i18n';

interface NodeDetailDrawerProps {
  workspaceId: string;
  nodeId: string | null;
  tagDefinitions?: KnowledgeTagDefinition[];
  onClose: () => void;
  onOpenPage: (workspaceId: string, nodeId: string) => void;
  onNodeChanged?: () => void;
}

const MIN_WIDTH = 320;
const MAX_WIDTH = 960;
const STORAGE_KEY = 'workspace-nodes:detail-drawer-width';

function readStoredWidth(): number {
  if (typeof window === 'undefined') return 420;
  const raw = window.localStorage?.getItem(STORAGE_KEY);
  const parsed = raw ? Number.parseInt(raw, 10) : NaN;
  if (!Number.isFinite(parsed)) return 420;
  return Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, parsed));
}

export const NodeDetailDrawer = ({
  workspaceId,
  nodeId,
  tagDefinitions = [],
  onClose,
  onOpenPage,
  onNodeChanged,
}: NodeDetailDrawerProps) => {
  const { t } = useI18n();
  const { node, loading, error, setNode } = useWorkspaceNode(workspaceId, nodeId);
  const { tags, reload: reloadTags } = useKnowledgeTags();
  const [width, setWidth] = useState<number>(() => readStoredWidth());
  const dragStateRef = useRef<{ startX: number; startWidth: number } | null>(null);

  useEffect(() => {
    try {
      window.localStorage?.setItem(STORAGE_KEY, String(width));
    } catch {
      // ignore quota errors
    }
  }, [width]);

  const handleMouseMove = useCallback((e: MouseEvent) => {
    const state = dragStateRef.current;
    if (!state) return;
    const next = state.startWidth - (e.clientX - state.startX);
    setWidth(Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, next)));
  }, []);

  const handleMouseUp = useCallback(() => {
    dragStateRef.current = null;
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
    window.removeEventListener('mousemove', handleMouseMove);
    window.removeEventListener('mouseup', handleMouseUp);
  }, [handleMouseMove]);

  const handleResizeMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    dragStateRef.current = { startX: e.clientX, startWidth: width };
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
  }, [handleMouseMove, handleMouseUp, width]);

  useEffect(() => () => {
    window.removeEventListener('mousemove', handleMouseMove);
    window.removeEventListener('mouseup', handleMouseUp);
  }, [handleMouseMove, handleMouseUp]);

  if (!nodeId) return null;

  return (
    <div className="node-detail-drawer" role="dialog" aria-label={t('workspaceNodes.nodeDetail')} style={{ width }}>
      <div
        className="node-detail-drawer__resize"
        role="separator"
        aria-orientation="vertical"
        aria-label={t('workspaceNodes.resizeNodeDetail')}
        onMouseDown={handleResizeMouseDown}
      />
      <NodeDetailPanel
        node={node}
        workspaceId={workspaceId}
        loading={loading}
        error={error}
        mode="drawer"
        onClose={onClose}
        onOpenPage={(nodeId) => onOpenPage(workspaceId, nodeId)}
        tagDefinitions={[...tagDefinitions, ...tags]}
        onNodePatched={(next) => {
          setNode(next);
          onNodeChanged?.();
        }}
        onTagsChanged={() => { void reloadTags(); }}
      />
    </div>
  );
};
