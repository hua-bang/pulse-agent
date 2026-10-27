import { useEffect, type MutableRefObject } from 'react';
import type { AgentNodeData, CanvasNode } from '../../../../types';

const SAVE_DELAY_MS = 400;

interface Options {
  prompt: string;
  /** True while the launch form shows and the node is editable. */
  active: boolean;
  dataRef: MutableRefObject<AgentNodeData>;
  nodeIdRef: MutableRefObject<string>;
  onUpdateRef: MutableRefObject<
    (id: string, patch: Partial<CanvasNode>, options?: { history?: boolean }) => void
  >;
}

/**
 * Saves the launch form's prompt as `draftPrompt` while the agent has not
 * started, so a reload before launch keeps it. The draft is not a launch
 * prompt: only `inlinePrompt` starts a session.
 */
export const useAgentPromptDraft = ({ prompt, active, dataRef, nodeIdRef, onUpdateRef }: Options) => {
  useEffect(() => {
    if (!active || prompt === (dataRef.current.draftPrompt ?? '')) return;
    const timer = window.setTimeout(() => {
      const nextData = { ...dataRef.current, draftPrompt: prompt };
      dataRef.current = nextData;
      onUpdateRef.current(nodeIdRef.current, { data: nextData }, { history: false });
    }, SAVE_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [active, prompt, dataRef, nodeIdRef, onUpdateRef]);
};
