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
  let activeSessionId: string | null = 'old';
  const handleNewSession = vi.fn(async () => ({ ok: true, activeSessionId: 'fresh' }));
  const Harness = ({ sessionId }: { sessionId: string | null }) => {
    submit = useSubmitPrompt({
      blocked: options.blocked ?? false,
      focusInput,
      notConfigured: options.notConfigured ?? false,
      openModelSettingsWithHint,
      requestContext,
      sendMessage,
      conversationSessionId: sessionId,
      handleNewSession,
    });
    return null;
  };
  const render = () => act(() => root.render(<Harness sessionId={activeSessionId} />));
  render();
  return {
    sendMessage,
    focusInput,
    openModelSettingsWithHint,
    handleNewSession,
    submit: (prompt: ChatPromptSubmission) => act(async () => await submit?.(prompt)),
    /** Starts a submission without awaiting it, for prompts that wait on a session switch. */
    start: (prompt: ChatPromptSubmission) => {
      let result: Promise<boolean> | undefined;
      act(() => { result = submit?.(prompt); });
      return result!;
    },
    activate: (sessionId: string) => {
      activeSessionId = sessionId;
      render();
    },
    unmount: () => act(() => root.unmount()),
  };
};

describe('useSubmitPrompt', () => {
  it('scopes the turn to the asked-about card instead of the current selection', async () => {
    const harness = mountSubmit();
    const card = { id: 'node-1', title: 'Research', type: 'text' as const };

    const sent = await harness.submit({ text: '  Which tier?  ', nodes: [card] });

    expect(sent).toBe(true);
    expect(harness.sendMessage).toHaveBeenCalledWith('Which tier? @[node:node-1|Research]', {
      scope: 'selected_nodes',
      selectedNodes: [card],
    });
    harness.unmount();
  });

  it('lets the sender mention context override the composer context', async () => {
    const harness = mountSubmit();
    const canvases = [{ id: 'b', name: 'Beta' }];

    await harness.submit({
      text: 'compare @[canvas:Beta]',
      nodes: [],
      context: { scope: 'selected_nodes', selectedNodes: [], canvases },
    });

    expect(harness.sendMessage).toHaveBeenCalledWith('compare @[canvas:Beta]', {
      scope: 'selected_nodes',
      selectedNodes: [],
      canvases,
    });
    harness.unmount();
  });

  it('does not repeat a chip the question already carries', async () => {
    const harness = mountSubmit();
    const card = { id: 'node-1', title: 'Research', type: 'text' as const };

    await harness.submit({ text: 'Explain @[node:node-1|Research]', nodes: [card] });

    expect(harness.sendMessage).toHaveBeenCalledWith('Explain @[node:node-1|Research]', expect.anything());
    harness.unmount();
  });

  it('starts a new session and sends only once that session is active', async () => {
    const harness = mountSubmit();
    const card = { id: 'node-1', title: 'Research', type: 'text' as const };

    const result = harness.start({ text: 'Which tier?', nodes: [card], newSession: true });
    await act(async () => { await Promise.resolve(); });
    expect(harness.handleNewSession).toHaveBeenCalledOnce();
    // `sendMessage` is still keyed to the old session: sending now would land there.
    expect(harness.sendMessage).not.toHaveBeenCalled();

    await act(async () => harness.activate('fresh'));
    // Further renders on the new key never send it a second time.
    await act(async () => harness.activate('fresh'));
    expect(harness.sendMessage).toHaveBeenCalledOnce();
    expect(harness.sendMessage).toHaveBeenCalledWith('Which tier? @[node:node-1|Research]', {
      scope: 'selected_nodes',
      selectedNodes: [card],
    });
    expect(await result).toBe(true);
    harness.unmount();
  });

  it('reports a new-session prompt as not sent when the surface unmounts first', async () => {
    const harness = mountSubmit();
    const result = harness.start({ text: 'Hi', nodes: [], newSession: true });
    await act(async () => { await Promise.resolve(); });
    harness.unmount();
    expect(await result).toBe(false);
    expect(harness.sendMessage).not.toHaveBeenCalled();
  });

  it('settles on unmount while session IPC is pending and ignores its late success', async () => {
    const harness = mountSubmit();
    let finish!: (value: { ok: boolean; activeSessionId: string }) => void;
    harness.handleNewSession.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const result = harness.start({ text: 'Hi', nodes: [], newSession: true });
    const settled = vi.fn();
    void result.then(settled);
    harness.unmount();
    await act(async () => { await Promise.resolve(); });
    expect(settled).toHaveBeenCalledWith(false);
    await act(async () => { finish({ ok: true, activeSessionId: 'fresh' }); });
    expect(await result).toBe(false);
    expect(harness.sendMessage).not.toHaveBeenCalled();
  });

  it('keeps a deferred creation single-flight and sends after the new key is ready', async () => {
    const harness = mountSubmit();
    let finish!: (value: { ok: boolean; activeSessionId: string }) => void;
    harness.handleNewSession.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const result = harness.start({ text: 'Hi', nodes: [], newSession: true });
    const duplicate = harness.start({ text: 'Again', nodes: [], newSession: true });
    await act(async () => harness.activate('fresh'));
    expect(harness.sendMessage).not.toHaveBeenCalled();
    await act(async () => { finish({ ok: true, activeSessionId: 'fresh' }); });
    expect(await duplicate).toBe(false);
    expect(await result).toBe(true);
    expect(harness.handleNewSession).toHaveBeenCalledOnce();
    expect(harness.sendMessage).toHaveBeenCalledOnce();
    harness.unmount();
  });

  it.each(['refused', 'missing-id', 'rejected'])('settles %s creation and allows a retry', async (failure) => {
    const harness = mountSubmit();
    if (failure === 'rejected') harness.handleNewSession.mockRejectedValueOnce(new Error('IPC failed'));
    else harness.handleNewSession.mockResolvedValueOnce({ ok: failure !== 'refused', activeSessionId: '' });
    expect(await harness.submit({ text: 'Hi', nodes: [], newSession: true })).toBe(false);
    expect(harness.sendMessage).not.toHaveBeenCalled();
    const retry = harness.start({ text: 'Retry', nodes: [], newSession: true });
    await act(async () => { await Promise.resolve(); });
    await act(async () => harness.activate('fresh'));
    expect(await retry).toBe(true);
    expect(harness.sendMessage).toHaveBeenCalledOnce();
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
