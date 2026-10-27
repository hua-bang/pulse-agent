// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AgentNodeData } from '../../../../types';
import { useAgentPromptDraft } from './useAgentPromptDraft';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  vi.useRealTimers();
});

const mount = (prompt: string, active: boolean, data: AgentNodeData) => {
  const onUpdate = vi.fn();
  const refs = {
    dataRef: { current: data },
    nodeIdRef: { current: 'agent-1' },
    onUpdateRef: { current: onUpdate },
  };
  const Harness = ({ value }: { value: string }) => {
    useAgentPromptDraft({ prompt: value, active, ...refs });
    return null;
  };
  root = createRoot(document.createElement('div'));
  act(() => root?.render(createElement(Harness, { value: prompt })));
  return {
    onUpdate,
    refs,
    rerender: (value: string) => act(() => root?.render(createElement(Harness, { value }))),
  };
};

describe('useAgentPromptDraft', () => {
  it('saves the typed prompt as a draft after a pause, without history', () => {
    vi.useFakeTimers();
    const { onUpdate, rerender, refs } = mount('', true, { status: 'idle' } as AgentNodeData);
    rerender('fix the');
    rerender('fix the build');
    act(() => { vi.advanceTimersByTime(500); });

    expect(onUpdate).toHaveBeenCalledTimes(1);
    expect(onUpdate).toHaveBeenCalledWith(
      'agent-1',
      { data: expect.objectContaining({ draftPrompt: 'fix the build' }) },
      { history: false },
    );
    expect(refs.dataRef.current.inlinePrompt).toBeUndefined();
  });

  it('does nothing while the launch form is not showing', () => {
    vi.useFakeTimers();
    const { onUpdate, rerender } = mount('', false, { status: 'running' } as AgentNodeData);
    rerender('typed in another view');
    act(() => { vi.advanceTimersByTime(500); });
    expect(onUpdate).not.toHaveBeenCalled();
  });
});
