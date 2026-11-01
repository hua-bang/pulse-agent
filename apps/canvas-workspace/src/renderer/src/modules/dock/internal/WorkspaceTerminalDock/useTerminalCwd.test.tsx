// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useTerminalCwd } from './useTerminalCwd';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Hook = ReturnType<typeof useTerminalCwd>;

describe('useTerminalCwd', () => {
  let root: Root;
  let hook: Hook;
  let shellCwd: string;
  const onCwdChange = vi.fn();

  const Probe = (props: { initialCwd?: string }) => {
    hook = useTerminalCwd({ sessionId: 's1', rootFolder: '/root-folder', onCwdChange, ...props });
    return null;
  };

  const mount = (props: { initialCwd?: string } = {}) => {
    root = createRoot(document.createElement('div'));
    act(() => root.render(<Probe {...props} />));
  };

  beforeEach(() => {
    vi.useFakeTimers();
    shellCwd = '/root-folder';
    onCwdChange.mockReset();
    (window as unknown as { canvasWorkspace: unknown }).canvasWorkspace = {
      pty: { getCwd: vi.fn(async () => ({ ok: true, cwd: shellCwd })) },
    };
  });

  afterEach(() => {
    act(() => root.unmount());
    vi.useRealTimers();
  });

  it('starts a restored shell in its saved folder, else the workspace root', () => {
    mount({ initialCwd: '/saved' });
    expect(hook.spawnCwd()).toBe('/saved');
    act(() => root.unmount());
    mount();
    expect(hook.spawnCwd()).toBe('/root-folder');
  });

  it('reads the folder again once output settles after a delayed cd', async () => {
    mount();
    // `sleep 1; cd /tmp`: the read right after Enter still sees the old folder.
    await act(async () => { hook.refreshCwd(); });
    expect(onCwdChange).toHaveBeenLastCalledWith('/root-folder');

    shellCwd = '/tmp';
    act(() => {
      hook.noteOutput();
      vi.advanceTimersByTime(200);
      hook.noteOutput();
    });
    expect(onCwdChange).toHaveBeenCalledTimes(1);
    await act(async () => { vi.advanceTimersByTime(400); });
    expect(onCwdChange).toHaveBeenLastCalledWith('/tmp');
    expect(hook.cwd).toBe('/tmp');
  });
});
