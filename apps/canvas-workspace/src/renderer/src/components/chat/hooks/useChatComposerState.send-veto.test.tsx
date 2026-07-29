// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const streamSendMessage = vi.fn(async () => true);
const replaceMessages = vi.fn();

// Only the composition is under test here: that every send funnels through
// the vetoed sendMessage. useChatSessions and useMentions run for real (the
// veto's input and one of its consumers); the streaming and model hooks are
// stubbed so the test doesn't need their IPC surface.
vi.mock('./useChatStream', () => ({
  useChatStream: () => ({ sendMessage: streamSendMessage, replaceMessages, loading: false }),
}));
vi.mock('../ModelSettings', () => ({ useCanvasModels: () => ({ status: undefined }) }));

const { useChatComposerState } = await import('./useChatComposerState');

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Hook = ReturnType<typeof useChatComposerState>;

let root: Root | null = null;
let host: HTMLDivElement | null = null;
let latest: Hook | null = null;
let resolveHistory: ((value: { ok: boolean; messages: [] }) => void) | null = null;

const Probe = () => {
  latest = useChatComposerState({ agentScope: { kind: 'global' } });
  return null;
};

beforeEach(async () => {
  streamSendMessage.mockClear();
  replaceMessages.mockClear();
  const history = new Promise<{ ok: boolean; messages: [] }>((resolve) => { resolveHistory = resolve; });
  (window as unknown as { canvasWorkspace: unknown }).canvasWorkspace = {
    agent: {
      getHistory: vi.fn(() => history),
      listSessions: vi.fn(async () => ({ ok: true, sessions: [] })),
    },
  };

  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => { root?.render(<Probe />); });
});

afterEach(() => {
  if (root) act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
  latest = null;
  resolveHistory = null;
  vi.restoreAllMocks();
});

async function settleHistory(): Promise<void> {
  await act(async () => {
    resolveHistory?.({ ok: true, messages: [] });
    await Promise.resolve();
  });
}

describe('send veto while the thread is loading', () => {
  it('blocks a programmatic send (quick action / DOM review path)', async () => {
    // Quick actions and DOM review call sendMessage directly, never the
    // composer's submit — this is the bypass the composer-level guard missed.
    expect(latest?.sessionLoading).toBe(true);

    let sent: boolean | undefined;
    await act(async () => { sent = await latest!.sendMessage('summarize this'); });

    expect(streamSendMessage).not.toHaveBeenCalled();
    expect(sent).toBe(false);
  });

  it('blocks the composer submit path too', async () => {
    await act(async () => { await latest!.submitCurrentInput(); });
    expect(streamSendMessage).not.toHaveBeenCalled();
  });

  it('lets sends through once the thread has loaded', async () => {
    await settleHistory();
    expect(latest?.sessionLoading).toBe(false);

    await act(async () => { await latest!.sendMessage('now it is safe'); });
    expect(streamSendMessage).toHaveBeenCalledTimes(1);
  });
});
