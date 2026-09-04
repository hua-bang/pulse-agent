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

  const handleAgentCreated = useCallback((node: CanvasNode) => {
    if (isAgentTeamTeammateNode(node)) return;
    const container = containerRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    const centerX = (node.x + node.width / 2) * transform.scale + transform.x;
    const centerY = (node.y + node.height / 2) * transform.scale + transform.y;
    if (centerX >= 0 && centerX <= rect.width && centerY >= 0 && centerY <= rect.height) return;
    notify({
      tone: 'info',
      title: t('canvas.agentAddedNode', { label: t(CANVAS_NODE_TYPE_LABEL_KEY[node.type]) }),
      description: t('canvas.agentAddedNodeOffscreen'),
      autoCloseMs: 8000,
      action: { label: t('canvas.jumpToNode'), onClick: () => focusNode(node) },
    });
  }, [containerRef, focusNode, notify, t, transform]);

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
  );
  useEffect(() => { flushSaveRef.current = document.flushSave; }, [document.flushSave]);

  return { ...document, hasAutoFittedRef };
};
