import { useCallback, useRef } from 'react';

interface RowHandlers {
  onToggleSection: (messageIndex: number) => void;
  onToggleToolExpand: (toolId: number) => void;
  onAddImageToCanvas?: (imagePath: string, title?: string) => Promise<void> | void;
  onEditUserMessage?: (index: number, newContent: string) => Promise<boolean> | void;
  onRegenerate?: (index: number) => Promise<boolean> | void;
  onFork?: (index: number) => Promise<boolean> | void;
  onSessionJump?: (sessionId: string, workspaceId: string, messageIndex?: number) => void;
}

/**
 * Surface callbacks change identity on every composer keystroke. Rows get
 * identity-stable forwarders to the latest handler instead, so the memoized
 * messages skip rendering. Optional handlers stay undefined when absent,
 * because rows use their presence to show actions.
 */
export function useStableRowHandlers(handlers: RowHandlers): RowHandlers {
  const latest = useRef(handlers);
  latest.current = handlers;
  const onToggleSection = useCallback((index: number) => latest.current.onToggleSection(index), []);
  const onToggleToolExpand = useCallback((toolId: number) => latest.current.onToggleToolExpand(toolId), []);
  const onAddImageToCanvas = useCallback(
    (imagePath: string, title?: string) => latest.current.onAddImageToCanvas?.(imagePath, title),
    [],
  );
  const onEditUserMessage = useCallback(
    (index: number, newContent: string) => latest.current.onEditUserMessage?.(index, newContent),
    [],
  );
  const onFork = useCallback((index: number) => latest.current.onFork?.(index), []);
  const onRegenerate = useCallback((index: number) => latest.current.onRegenerate?.(index), []);
  const onSessionJump = useCallback(
    (sessionId: string, workspaceId: string, messageIndex?: number) => (
      latest.current.onSessionJump?.(sessionId, workspaceId, messageIndex)
    ),
    [],
  );
  return {
    onToggleSection,
    onToggleToolExpand,
    onAddImageToCanvas: handlers.onAddImageToCanvas ? onAddImageToCanvas : undefined,
    onEditUserMessage: handlers.onEditUserMessage ? onEditUserMessage : undefined,
    onFork: handlers.onFork ? onFork : undefined,
    onRegenerate: handlers.onRegenerate ? onRegenerate : undefined,
    onSessionJump: handlers.onSessionJump ? onSessionJump : undefined,
  };
}
