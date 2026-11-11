import { useCallback, useEffect, useRef, type RefObject } from 'react';
import type { AgentNodeData, CanvasNode, CanvasTransform } from '../../../types';
import { CANVAS_NODE_TYPE_LABEL_KEY } from '../../../utils/nodeTypeI18n';
import { useAppShell } from '../../../shared/appShell';
import { useI18n } from '../../../i18n';
import { useCanvasDocument } from './useCanvasDocument';

interface Options {
  canvasId: string;
  persistViewport: boolean;
  containerRef: RefObject<HTMLDivElement>;
  transform: CanvasTransform;
  setTransform: (transform: CanvasTransform) => void;
  focusNode: (node: CanvasNode) => void;
}

const isAgentTeamTeammateNode = (node: CanvasNode): boolean => {
  if (node.type !== 'agent') return false;
  const data = node.data as AgentNodeData;
  return !!data.agentTeamId && data.agentTeamRole === 'teammate';
};

/** Agent-created nodes that arrive within this window share one toast. */
const OFFSCREEN_BATCH_MS = 400;
/** Below this zoom, node content is not readable. */
const MIN_READABLE_SCALE = 0.25;

const nodesBounds = (nodes: readonly CanvasNode[]) => {
  const x = Math.min(...nodes.map(node => node.x));
  const y = Math.min(...nodes.map(node => node.y));
  return {
    x,
    y,
    width: Math.max(...nodes.map(node => node.x + node.width)) - x,
    height: Math.max(...nodes.map(node => node.y + node.height)) - y,
  };
};

export const useCanvasDocumentHost = ({
  canvasId,
  persistViewport,
  containerRef,
  transform,
  setTransform,
  focusNode,
}: Options) => {
  const { dismissToast, notify } = useAppShell();
  const { t } = useI18n();
  const flushSaveRef = useRef<() => void>(() => undefined);
  const saveErrorToastIdRef = useRef<string | null>(null);
  const hasAutoFittedRef = useRef(false);

  const handleSaveError = useCallback(() => {
    if (saveErrorToastIdRef.current) dismissToast(saveErrorToastIdRef.current);
    saveErrorToastIdRef.current = notify({
      tone: 'error',
      title: t('canvas.saveFailed'),
      description: t('canvas.saveFailedDescription'),
      autoCloseMs: 0,
      action: {
        label: t('canvas.saveRetry'),
        onClick: () => {
          saveErrorToastIdRef.current = null;
          flushSaveRef.current();
        },
      },
    });
  }, [dismissToast, notify, t]);

  const handleConflictResolved = useCallback(() => {
    notify({
      tone: 'info',
      title: t('canvas.keptLocalEdit'),
      description: t('canvas.keptLocalEditDescription'),
      autoCloseMs: 8000,
    });
  }, [notify, t]);

  // An agent turn can add many nodes at once. Collect the nodes that land
  // outside the view and show one toast for the batch.
  const offscreenCreatedRef = useRef<CanvasNode[]>([]);
  const offscreenTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (offscreenTimerRef.current) clearTimeout(offscreenTimerRef.current);
  }, []);

  const announceOffscreenNodes = useCallback(() => {
    offscreenTimerRef.current = null;
    const created = offscreenCreatedRef.current;
    offscreenCreatedRef.current = [];
    if (created.length === 0) return;
    const [first] = created;
    // A batch that is spread too far to read in one view jumps to its first node.
    const rect = containerRef.current?.getBoundingClientRect();
    const box = nodesBounds(created);
    const readable = !!rect
      && Math.min(rect.width / box.width, rect.height / box.height) >= MIN_READABLE_SCALE;
    const target = readable ? { ...first, ...box } : first;
    notify({
      tone: 'info',
      title: created.length === 1
        ? t('canvas.agentAddedNode', { label: t(CANVAS_NODE_TYPE_LABEL_KEY[first.type]) })
        : t('canvas.agentAddedNodes', { count: created.length }),
      description: created.length === 1 && first.title
        ? `${first.title} · ${t('canvas.agentAddedNodeOffscreen')}`
        : t('canvas.agentAddedNodeOffscreen'),
      autoCloseMs: 8000,
      action: { label: t('canvas.jumpToNode'), onClick: () => focusNode(target) },
    });
  }, [containerRef, focusNode, notify, t]);

  const handleAgentCreated = useCallback((node: CanvasNode) => {
    if (isAgentTeamTeammateNode(node)) return;
    const container = containerRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    const centerX = (node.x + node.width / 2) * transform.scale + transform.x;
    const centerY = (node.y + node.height / 2) * transform.scale + transform.y;
    if (centerX >= 0 && centerX <= rect.width && centerY >= 0 && centerY <= rect.height) return;
    offscreenCreatedRef.current.push(node);
    if (offscreenTimerRef.current) clearTimeout(offscreenTimerRef.current);
    offscreenTimerRef.current = setTimeout(announceOffscreenNodes, OFFSCREEN_BATCH_MS);
  }, [announceOffscreenNodes, containerRef, transform]);

  const document = useCanvasDocument(
    canvasId,
    persistViewport
      ? (savedTransform) => {
          hasAutoFittedRef.current = true;
          setTransform(savedTransform);
        }
      : undefined,
    handleAgentCreated,
    handleSaveError,
    handleConflictResolved,
  );
  useEffect(() => { flushSaveRef.current = document.flushSave; }, [document.flushSave]);

  return { ...document, hasAutoFittedRef };
};
