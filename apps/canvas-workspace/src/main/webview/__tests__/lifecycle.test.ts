import { describe, expect, it, vi } from 'vitest';
import { setWebviewLifecycle, type FreezableWebContents } from '../lifecycle';

const makeWc = (overrides: Partial<{
  destroyed: boolean;
  audible: boolean;
  devtools: boolean;
  attached: boolean;
  attachError: Error;
  commandError: Error;
}> = {}) => {
  let attached = overrides.attached ?? false;
  const debuggerApi = {
    isAttached: () => attached,
    attach: vi.fn(() => {
      if (overrides.attachError) throw overrides.attachError;
      attached = true;
    }),
    detach: vi.fn(() => {
      attached = false;
    }),
    sendCommand: vi.fn(async () => {
      if (overrides.commandError) throw overrides.commandError;
      return {};
    }),
  };
  const wc: FreezableWebContents = {
    isDestroyed: () => overrides.destroyed ?? false,
    isCurrentlyAudible: () => overrides.audible ?? false,
    isDevToolsOpened: () => overrides.devtools ?? false,
    debugger: debuggerApi,
  };
  return { wc, debuggerApi };
};

describe('setWebviewLifecycle', () => {
  it('freezes via debugger attach + Page.setWebLifecycleState and holds the pipe', async () => {
    const { wc, debuggerApi } = makeWc();
    const result = await setWebviewLifecycle(wc, 'frozen');
    expect(result).toEqual({ ok: true, state: 'frozen' });
    expect(debuggerApi.attach).toHaveBeenCalledWith('1.3');
    expect(debuggerApi.sendCommand).toHaveBeenCalledWith('Page.setWebLifecycleState', { state: 'frozen' });
    // The pipe stays attached while frozen (released on resume).
    expect(debuggerApi.detach).not.toHaveBeenCalled();
  });

  it('mirrors Chrome exemptions: audible and devtools pages are never frozen', async () => {
    const audible = makeWc({ audible: true });
    expect(await setWebviewLifecycle(audible.wc, 'frozen')).toEqual({ ok: false, skipped: 'audible' });
    expect(audible.debuggerApi.attach).not.toHaveBeenCalled();

    const devtools = makeWc({ devtools: true });
    expect(await setWebviewLifecycle(devtools.wc, 'frozen')).toEqual({ ok: false, skipped: 'devtools' });
  });

  it('reports destroyed / missing webContents as a non-retryable skip', async () => {
    expect(await setWebviewLifecycle(null, 'frozen')).toEqual({ ok: false, skipped: 'destroyed' });
    const gone = makeWc({ destroyed: true });
    expect(await setWebviewLifecycle(gone.wc, 'active')).toEqual({ ok: false, skipped: 'destroyed' });
  });

  it('surfaces an attach conflict (external debugger) as a retryable error', async () => {
    const { wc } = makeWc({ attachError: new Error('Another debugger is already attached') });
    const result = await setWebviewLifecycle(wc, 'frozen');
    expect(result.ok).toBe(false);
    expect(result.error).toContain('Another debugger');
    expect(result.skipped).toBeUndefined();
  });

  it('resume sends active and always releases the debugger pipe', async () => {
    const { wc, debuggerApi } = makeWc({ attached: true });
    const result = await setWebviewLifecycle(wc, 'active');
    expect(result).toEqual({ ok: true, state: 'active' });
    expect(debuggerApi.sendCommand).toHaveBeenCalledWith('Page.setWebLifecycleState', { state: 'active' });
    expect(debuggerApi.detach).toHaveBeenCalled();
  });

  it('resume detaches even when the resume command fails', async () => {
    const { wc, debuggerApi } = makeWc({ attached: true, commandError: new Error('target closed') });
    const result = await setWebviewLifecycle(wc, 'active');
    expect(result.ok).toBe(false);
    expect(debuggerApi.detach).toHaveBeenCalled();
  });

  it('resume on a never-frozen page is a no-op success (external detach already unfreezes)', async () => {
    const { wc, debuggerApi } = makeWc({ attached: false });
    expect(await setWebviewLifecycle(wc, 'active')).toEqual({ ok: true, state: 'active' });
    expect(debuggerApi.sendCommand).not.toHaveBeenCalled();
  });
});
