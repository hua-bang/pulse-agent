// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { useChatRenderTiming } from './useChatRenderTiming';
import type { AgentChatMessage } from '../../../types';

const mark = vi.hoisted(() => vi.fn());
vi.mock('./markAgentMilestone', () => ({ markAgentMilestone: mark }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

it('records committed text and completion once per live run, excluding history', () => {
  const host = document.createElement('div');
  const root = createRoot(host);
  const Probe = ({ message, streaming }: { message: AgentChatMessage; streaming: boolean }) => {
    useChatRenderTiming(message, streaming);
    return createElement('span', null, message.content);
  };
  const render = (runId: string, content: string, streaming: boolean) => act(() => {
    root.render(createElement(Probe, { message: { role: 'assistant', timestamp: 0, runId, content }, streaming }));
  });
  try {
    render('history', 'old', false);
    expect(mark).not.toHaveBeenCalled();
    render('one', '', true);
    expect(mark).not.toHaveBeenCalled();
    render('one', 'hello', true);
    render('one', 'hello world', true);
    render('one', 'hello world', false);
    expect(mark.mock.calls).toEqual([
      ['one', 'ui.first-content-rendered'], ['one', 'ui.response-completed'],
    ]);
    render('two', 'next', true);
    render('two', 'next', false);
    expect(mark.mock.calls.slice(2)).toEqual([
      ['two', 'ui.first-content-rendered'], ['two', 'ui.response-completed'],
    ]);
  } finally {
    act(() => root.unmount());
  }
});
