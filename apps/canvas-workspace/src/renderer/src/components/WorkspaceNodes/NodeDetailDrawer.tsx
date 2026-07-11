import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import type { KnowledgeTagDefinition } from '../../types';
import { useI18n } from '../../i18n';
import { useDragResize } from '../ui';
import { NodeDetailPanel } from './NodeDetailPanel';
import { useKnowledgeTags, useWorkspaceNode } from './useWorkspaceNodes';

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
const DEFAULT_WIDTH = 520;
const KEYBOARD_RESIZE_STEP = 24;
const STORAGE_KEY = 'workspace-nodes:detail-drawer-width';

function readStoredWidth(): number {
  if (typeof window === 'undefined') return DEFAULT_WIDTH;
  const raw = window.localStorage?.getItem(STORAGE_KEY);
  const parsed = raw ? Number.parseInt(raw, 10) : NaN;
  if (!Number.isFinite(parsed)) return DEFAULT_WIDTH;
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
  const drawerRef = useRef<HTMLDivElement>(null);
  const resizeHandlers = useDragResize({
    axis: 'x',
    value: width,
    min: MIN_WIDTH,
    max: MAX_WIDTH,
    invert: true,
    onChange: setWidth,
  });

  useEffect(() => {
    try {
      window.localStorage?.setItem(STORAGE_KEY, String(width));
    } catch {
      // Ignore quota and privacy-mode storage failures.
    }
  }, [width]);

  useEffect(() => {
    if (!nodeId) return undefined;
    const frame = requestAnimationFrame(() => {
      drawerRef.current?.querySelector<HTMLButtonElement>('.node-detail-panel__close')?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [nodeId]);

  const handleResizeKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    let next: number | null = null;
    if (event.key === 'ArrowLeft') next = width + KEYBOARD_RESIZE_STEP;
    if (event.key === 'ArrowRight') next = width - KEYBOARD_RESIZE_STEP;
    if (event.key === 'Home') next = MIN_WIDTH;
    if (event.key === 'End') next = MAX_WIDTH;
    if (next === null) return;
    event.preventDefault();
    setWidth(Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, next)));
  };

  if (!nodeId) return null;

  return (
    <div ref={drawerRef} className="node-detail-drawer" role="dialog" aria-label={t('workspaceNodes.nodeDetail')} style={{ width }}>
      <div
        className="node-detail-drawer__resize"
        role="separator"
        tabIndex={0}
        aria-orientation="vertical"
        aria-label={t('workspaceNodes.resizeNodeDetail')}
        aria-valuemin={MIN_WIDTH}
        aria-valuemax={MAX_WIDTH}
        aria-valuenow={width}
        onMouseDown={resizeHandlers.onMouseDown}
        onKeyDown={handleResizeKeyDown}
      />
      <NodeDetailPanel
        node={node}
        workspaceId={workspaceId}
        loading={loading}
        error={error}
        mode="drawer"
        onClose={onClose}
        onOpenPage={(nextNodeId) => onOpenPage(workspaceId, nextNodeId)}
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
