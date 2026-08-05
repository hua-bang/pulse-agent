// @vitest-environment happy-dom
import { act, useCallback, useRef, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../../../i18n';
import { ChatSessionsRail } from '../ChatSessionsRail';
import { useChatPageSessionRail } from '../hooks/useChatPageSessionRail';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLDivElement | null = null;

afterEach(() => {
  if (root) act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
  vi.restoreAllMocks();
});

interface RailHarnessProps {
  createSession: () => Promise<{ ok: boolean }>;
  initiallyAdopted?: boolean;
}

const RailHarness = ({ createSession, initiallyAdopted = false }: RailHarnessProps) => {
  const composerRef = useRef<HTMLDivElement>(null);
  const [sessionAdopted, setSessionAdopted] = useState(initiallyAdopted);
  const handleNewSession = useCallback(async () => {
    const result = await createSession();
    if (result.ok) setSessionAdopted(true);
    return result;
  }, [createSession]);
  const rail = useChatPageSessionRail({
    agentScope: { kind: 'workspace', workspaceId: 'workspace-1' },
    allWorkspaces: [],
    currentScopeName: null,
    sessionsLoading: false,
    otherSessions: [],
    selectedSessionKey: null,
    sessions: [],
    disabled: false,
    focusInput: () => composerRef.current?.focus(),
    handleNewSession,
    onSelectSession: vi.fn(),
    renameSession: vi.fn(async () => undefined),
    deleteSession: vi.fn(async () => undefined),
    toggleSessionPinned: vi.fn(async () => undefined),
  });
  return (
    <>
      <ChatSessionsRail {...rail} />
      {sessionAdopted && (
        <div ref={composerRef} role="textbox" contentEditable tabIndex={0} aria-label="Adopted composer" />
      )}
    </>
  );
};

describe('New chat focus recovery', () => {
  it('focuses the composer after the new session has been adopted and rendered', async () => {
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => root?.render(
      <I18nProvider>
        <RailHarness createSession={vi.fn(async () => ({ ok: true }))} />
      </I18nProvider>,
    ));

    act(() => {
      host?.querySelector<HTMLButtonElement>('.chat-page-rail-new')?.click();
    });
    await act(async () => {
      await Promise.resolve();
    });
    await act(async () => {
      await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
    });

    expect(document.activeElement).toBe(host.querySelector('[aria-label="Adopted composer"]'));
  });

  it('does not focus the composer when creating the new session fails', async () => {
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => root?.render(
      <I18nProvider>
        <RailHarness
          createSession={vi.fn(async () => ({ ok: false }))}
          initiallyAdopted
        />
      </I18nProvider>,
    ));
    const newChat = host.querySelector<HTMLButtonElement>('.chat-page-rail-new');
    newChat?.focus();

    act(() => newChat?.click());
    await act(async () => {
      await Promise.resolve();
      await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
    });

    expect(document.activeElement).toBe(newChat);
  });

  it('does not steal focus when the user moves to another control while a new session opens', async () => {
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    let resolveSession!: (result: { ok: boolean }) => void;
    await act(async () => root?.render(
      <I18nProvider>
        <RailHarness
          createSession={() => new Promise(resolve => { resolveSession = resolve; })}
          initiallyAdopted
        />
      </I18nProvider>,
    ));
    const newChat = host.querySelector<HTMLButtonElement>('.chat-page-rail-new');
    const otherControl = document.createElement('button');
    document.body.appendChild(otherControl);
    newChat?.focus();

    act(() => newChat?.click());
    otherControl.focus();
    await act(async () => {
      resolveSession({ ok: true });
      await Promise.resolve();
    });
    await act(async () => {
      await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
    });

    expect(document.activeElement).toBe(otherControl);
    otherControl.remove();
  });
});
