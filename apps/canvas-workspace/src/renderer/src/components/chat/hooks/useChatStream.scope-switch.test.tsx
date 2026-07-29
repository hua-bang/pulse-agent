// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import type { AgentChatMessage } from '../../../types';
import type { AgentScope } from '../types';
import { useChatStream } from './useChatStream';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Hook = ReturnType<typeof useChatStream>;

let root: Root | null = null;
let host: HTMLDivElement | null = null;
let latest: Hook | null = null;

const Probe = ({ scope }: { scope: AgentScope }) => {
  latest = useChatStream({ agentScope: scope });
  return null;
};

const message = (content: string): AgentChatMessage => ({
  role: 'user',
  content,
  timestamp: 1,
});

afterEach(() => {
  if (root) act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
  latest = null;
});

describe('useChatStream scope switching', () => {
  it('keeps the rendered thread until the next scope history arrives', async () => {
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);

    await act(async () => {
      root?.render(<Probe scope={{ kind: 'global' }} />);
    });
    await act(async () => {
      latest!.replaceMessages([message('current thread')]);
    });

    await act(async () => {
      root?.render(<Probe scope={{ kind: 'workspace', workspaceId: 'scope-switch-target' }} />);
    });

    expect(latest?.messages).toEqual([message('current thread')]);

    await act(async () => {
      latest!.replaceMessages([message('target thread')]);
    });
    expect(latest?.messages).toEqual([message('target thread')]);
  });
});
