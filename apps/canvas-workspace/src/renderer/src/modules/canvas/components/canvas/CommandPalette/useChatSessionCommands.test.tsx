// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { onOpenChatSessionRequest, type OpenChatSessionRequest } from '../../../../../shared/appCommands';
import type { PaletteCommand } from './model';
import { useChatSessionCommands } from './useChatSessionCommands';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  vi.useRealTimers();
  delete (window as unknown as { canvasWorkspace?: unknown }).canvasWorkspace;
});

describe('useChatSessionCommands', () => {
  it('searches after a pause and opens the hit in its store', async () => {
    vi.useFakeTimers();
    const searchSessions = vi.fn(async () => ({
      ok: true,
      hits: [{
        sessionId: 's1',
        workspaceId: 'w1',
        workspaceName: 'Research',
        date: '2026-11-15',
        isCurrent: false,
        messageCount: 4,
        preview: 'Plan the launch',
      }],
    }));
    (window as unknown as { canvasWorkspace: unknown }).canvasWorkspace = { agent: { searchSessions } };
    let latest: PaletteCommand[] = [];
    const Probe = ({ query }: { query: string }) => {
      latest = useChatSessionCommands(query);
      return null;
    };
    const container = document.createElement('div');
    root = createRoot(container);

    act(() => root?.render(<Probe query="" />));
    act(() => root?.render(<Probe query="launch" />));
    expect(searchSessions).not.toHaveBeenCalled();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });

    expect(searchSessions).toHaveBeenCalledWith('launch', 6, 'title');
    expect(latest.map((command) => [command.id, command.title, command.hint]))
      .toEqual([['chat:w1:s1', 'Plan the launch', 'Research · 2026-11-15']]);

    const requests: OpenChatSessionRequest[] = [];
    const unsubscribe = onOpenChatSessionRequest((request) => requests.push(request));
    latest[0].run();
    unsubscribe();
    expect(requests).toEqual([{ sessionId: 's1', storeId: 'w1', label: 'Research' }]);

    act(() => root?.render(<Probe query="" />));
    expect(latest).toEqual([]);
  });
});
