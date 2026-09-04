// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentNodeData, CanvasWorkspaceApi } from '../../../types';

const terminalHarness = vi.hoisted(() => ({ instances: [] as Array<{ input?: (data: string) => void; output: string[] }> }));

vi.mock('@xterm/addon-fit', () => ({
  FitAddon: class {
    fit() {}
    proposeDimensions() { return { cols: 80, rows: 24 }; }
  },
}));

vi.mock('@xterm/xterm', () => ({
  Terminal: class {
    cols = 80;
    rows = 24;
    element: HTMLElement | undefined;
    buffer = { active: { length: 1, baseY: 0, cursorY: 0, getLine: () => ({ translateToString: () => '' }) } };
    options: Record<string, unknown> = {};
    output: string[] = [];
    input?: (data: string) => void;
    constructor() { terminalHarness.instances.push(this); }
    loadAddon() {}
    open(container: HTMLElement) { this.element = document.createElement('div'); container.appendChild(this.element); }
    attachCustomKeyEventHandler() {}
    onData(listener: (data: string) => void) { this.input = listener; return { dispose() {} }; }
    onResize() { return { dispose() {} }; }
    write(value: string) { this.output.push(value); }
    writeln(value = '') { this.output.push(value); }
    refresh() {}
    scrollToBottom() {}
    dispose() {}
  },
}));

import { mountOwnerTerminal, mountReadonlyTerminal } from '..';

describe('owner terminal lifecycle', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    terminalHarness.instances.length = 0;
  });

  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
  });

  it('spawns the PTY and writes the node-bound agent command after the shell is ready', async () => {
    let shellData: ((data: string) => void) | undefined;
    let data: AgentNodeData = { agentType: 'claude-code', sessionId: 'pty-1', status: 'running' };
    const pty = {
      spawn: vi.fn().mockResolvedValue({ ok: true, leaseId: 'lease-1' }),
      write: vi.fn(), resize: vi.fn(), kill: vi.fn(),
      getCwd: vi.fn().mockResolvedValue({ ok: true, cwd: '/repo' }),
      checkCommand: vi.fn(),
      onData: vi.fn((_id: string, listener: (value: string) => void) => { shellData = listener; return vi.fn(); }),
      onExit: vi.fn(() => vi.fn()),
    } as unknown as CanvasWorkspaceApi['pty'];
    const mount = mountOwnerTerminal({
      container: document.createElement('div'),
      request: { nodeId: 'node-1', sessionId: 'pty-1', agentType: 'claude-code', cwd: '/repo', resume: false },
      state: {
        get: () => data,
        update: (mutate) => { data = mutate(data); return data; },
      },
      adapters: { pty },
      events: { onLoadingChange: vi.fn(), onExit: vi.fn(), onKeyEvent: () => true },
    });

    await vi.waitFor(() => expect(pty.spawn).toHaveBeenCalledTimes(1));
    shellData?.('$ ');
    await vi.advanceTimersByTimeAsync(100);
    expect(pty.write).toHaveBeenCalledWith(
      'pty-1',
      expect.stringContaining('claude --session-id'),
    );
    expect(data.cliSessionId).toBeTruthy();
    mount.dispose();
  });

  it('mounts saved output without requiring a PTY bridge in read-only mode', () => {
    const mount = mountReadonlyTerminal({
      container: document.createElement('div'),
      scrollback: 'first line\nsecond line',
    });
    expect(terminalHarness.instances[0].output.join('\n')).toContain('first line\r\nsecond line');
    mount.dispose();
  });
});
