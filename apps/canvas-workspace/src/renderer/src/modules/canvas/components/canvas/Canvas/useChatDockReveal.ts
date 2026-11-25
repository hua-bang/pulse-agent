import { useCallback, useEffect, useRef, type MutableRefObject } from 'react';
import type { CanvasNode, CanvasTransform } from '../../../../../types';
import type { ChatDeliveryReceipt } from '../../../../chat';

interface Options {
  nodesRef: MutableRefObject<CanvasNode[]>;
  selectedNodeIds: string[];
  chatPanelOpen?: boolean;
  fullscreenNodeIdRef: MutableRefObject<string | null>;
  getLiveTransform: () => CanvasTransform;
  revealNode: (node: CanvasNode, getTransform: () => CanvasTransform) => Promise<void>;
  onAddToChat?: (nodeId: string) => void | Promise<ChatDeliveryReceipt>;
}

/**
 * Keeps a discussed node visible when the right chat dock opens or receives
 * a node reference, without disturbing the pinned fullscreen camera.
 */
export const useChatDockReveal = ({
  nodesRef,
  selectedNodeIds,
  chatPanelOpen,
  fullscreenNodeIdRef,
  getLiveTransform,
  revealNode,
  onAddToChat,
}: Options) => {
  const addReferenceToChat = useCallback(async (nodeId: string) => {
    const receipt = await onAddToChat?.(nodeId);
    const node = nodesRef.current.find((item) => item.id === nodeId);
    if (
      node
      && !fullscreenNodeIdRef.current
      && (receipt?.status === 'delivered' || receipt?.status === 'queued')
    ) {
      void revealNode(node, getLiveTransform);
    }
    return receipt ?? { status: 'unavailable' as const, target: null };
  }, [fullscreenNodeIdRef, getLiveTransform, nodesRef, onAddToChat, revealNode]);

  // Opening the chat dock narrows the canvas; keep a lone selected node,
  // usually the one about to be discussed, from ending up under the dock.
  // Fullscreen pins its own camera at (-node.x, -node.y, 1) so CSS % sizing
  // reflows automatically without moving the transform.
  const chatWasOpenRef = useRef(chatPanelOpen);
  useEffect(() => {
    const opened = chatPanelOpen && !chatWasOpenRef.current;
    chatWasOpenRef.current = chatPanelOpen;
    if (fullscreenNodeIdRef.current) return;
    const node = opened && selectedNodeIds.length === 1
      ? nodesRef.current.find((item) => item.id === selectedNodeIds[0]) : undefined;
    if (node) void revealNode(node, getLiveTransform);
  }, [chatPanelOpen]); // eslint-disable-line react-hooks/exhaustive-deps

  return { addReferenceToChat };
};
