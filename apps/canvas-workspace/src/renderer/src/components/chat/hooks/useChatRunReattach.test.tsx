// @vitest-environment happy-dom
import { act, useRef, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { AgentChatMessage } from '../../../types';
import type { PendingClarification, ToolCallStatus } from '../types';
import { useChatRunReattach } from './useChatRunReattach';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLDivElement | null = null;
let reattach: ((sessionId: string) => void) | null = null;
let visibleMessages: AgentChatMessage[] = [];

const Probe = () => {
  const [messages, setMessages] = useState<AgentChatMessage[]>([]);
  const [, setStreamingTools] = useState<ToolCallStatus[]>([]);
  const [, setMessageTools] = useState<Map<number, ToolCallStatus[]>>(new Map());
  const [, setCollapsedSections] = useState<Set<number>>(new Set());
  const [, setPendingClarify] = useState<PendingClarification | null>(null);
  const [, setClarifyInput] = useState('');
  const [, setClarificationAnswering] = useState(false);
  const [, setClarificationError] = useState<string | null>(null);
  const [, setLoading] = useState(false);
  const streamingMsgIdx = useRef(-1);
  const toolIdCounter = useRef(0);
  const activeUnsubsRef = useRef<Array<() => void>>([]);
  visibleMessages = messages;
  reattach = useChatRunReattach({
    agentScope: { kind: 'global' },
    setMessages,
    setStreamingTools,
    setMessageTools,
    setCollapsedSections,
    setPendingClarify,
    setClarifyInput,
    setClarificationAnswering,
    setClarificationError,
    setLoading,
    streamingMsgIdx,
    toolIdCounter,
    activeUnsubsRef,
    replaceMessages: setMessages,
  }).reattachToRun;
  return null;
};

afterEach(() => {
  if (root) act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
  reattach = null;
  visibleMessages = [];
  vi.restoreAllMocks();
  delete (window as unknown as { canvasWorkspace?: unknown }).canvasWorkspace;
});

describe('useChatRunReattach', () => {
  it('loads the durable baseline before requesting replay events', async () => {
    let resolveHistory!: (value: {
      ok: true;
      messages: AgentChatMessage[];
      activeSessionId: string;
    }) => void;
    const history = new Promise<{
      ok: true;
      messages: AgentChatMessage[];
      activeSessionId: string;
    }>(resolve => { resolveHistory = resolve; });
    const getHistory = vi.fn(() => history);
    const getRunStatus = vi.fn(async () => ({
      ok: true,
      active: false,
      replay: { active: false, cursor: 0, events: [] },
    }));
    (window as unknown as { canvasWorkspace: unknown }).canvasWorkspace = {
      agent: { getHistory, getRunStatus },
    };
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => root?.render(<Probe />));

    act(() => reattach?.('run-background'));
    expect(getHistory).toHaveBeenCalledOnce();
    expect(getRunStatus).not.toHaveBeenCalled();

    const baseline: AgentChatMessage[] = [
      { role: 'user', content: 'Question', timestamp: 1 },
    ];
    await act(async () => {
      resolveHistory({ ok: true, messages: baseline, activeSessionId: 'conversation-a' });
      await history;
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(getRunStatus).toHaveBeenCalledWith('run-background', 0);
    expect(visibleMessages).toEqual(baseline);
  });
});
