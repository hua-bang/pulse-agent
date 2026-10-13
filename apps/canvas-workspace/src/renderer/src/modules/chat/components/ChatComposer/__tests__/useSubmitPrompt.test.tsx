// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import type { AgentRequestContext } from '../../../../../types';
import type { ChatPromptSubmission } from '../../../target';
import { useSubmitPrompt } from '../useSubmitPrompt';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mountSubmit = (options: { blocked?: boolean; notConfigured?: boolean } = {}) => {
  const host = document.createElement('div');
  const root = createRoot(host);
  const sendMessage = vi.fn(async () => true);
  const focusInput = vi.fn();
  const openModelSettingsWithHint = vi.fn();
  const requestContext: AgentRequestContext = {
    scope: 'current_canvas',
    selectedNodes: [{ id: 'other', title: 'Other card', type: 'text' }],
  };
  let submit: ((prompt: ChatPromptSubmission) => Promise<boolean>) | undefined;
  const Harness = () => {
    submit = useSubmitPrompt({
      blocked: options.blocked ?? false,
      focusInput,
      notConfigured: options.notConfigured ?? false,
      openModelSettingsWithHint,
      requestContext,
      sendMessage,
    });
    return null;
  };
  act(() => root.render(<Harness />));
  return {
    sendMessage,
    focusInput,
    openModelSettingsWithHint,
    submit: (prompt: ChatPromptSubmission) => act(async () => await submit?.(prompt)),
    unmount: () => act(() => root.unmount()),
  };
};

describe('useSubmitPrompt', () => {
  it('scopes the turn to the asked-about card instead of the current selection', async () => {
    const harness = mountSubmit();
    const card = { id: 'node-1', title: 'Research', type: 'text' as const };

    const sent = await harness.submit({ text: '  Which tier?  ', nodes: [card] });

    expect(sent).toBe(true);
    expect(harness.sendMessage).toHaveBeenCalledWith('Which tier?', {
      scope: 'selected_nodes',
      selectedNodes: [card],
    });
    harness.unmount();
  });

  it('keeps the composer context when the prompt names no nodes', async () => {
    const harness = mountSubmit();

    await harness.submit({ text: 'Summarize', nodes: [] });

    expect(harness.sendMessage).toHaveBeenCalledWith('Summarize', {
      scope: 'current_canvas',
      selectedNodes: [{ id: 'other', title: 'Other card', type: 'text' }],
    });
    harness.unmount();
  });

  it('keeps empty, blocked, and unconfigured prompts out of the send path', async () => {
    const empty = mountSubmit();
    expect(await empty.submit({ text: '   ', nodes: [] })).toBe(false);
    expect(empty.focusInput).toHaveBeenCalledOnce();
    empty.unmount();

    const blocked = mountSubmit({ blocked: true });
    expect(await blocked.submit({ text: 'Hi', nodes: [] })).toBe(false);
    blocked.unmount();

    const unconfigured = mountSubmit({ notConfigured: true });
    expect(await unconfigured.submit({ text: 'Hi', nodes: [] })).toBe(false);
    expect(unconfigured.openModelSettingsWithHint).toHaveBeenCalledOnce();
    unconfigured.unmount();

    for (const harness of [empty, blocked, unconfigured]) {
      expect(harness.sendMessage).not.toHaveBeenCalled();
    }
  });
});
