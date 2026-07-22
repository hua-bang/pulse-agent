import { describe, expect, it, vi } from 'vitest';
import {
  getWebviewFreezeExemption,
  setWebviewLifecycle,
  type FreezableWebContents,
} from '../lifecycle';

const makeWc = (overrides: Partial<{
  destroyed: boolean;
  audible: boolean;
  devtools: boolean;
  attached: boolean;
  attachError: Error;
  commandError: Error;
  getUrl: () => string;
  url: string;
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
    getURL: overrides.getUrl ?? (() => overrides.url ?? 'https://example.com/'),
    isDestroyed: () => overrides.destroyed ?? false,
    isCurrentlyAudible: () => overrides.audible ?? false,
    isDevToolsOpened: () => overrides.devtools ?? false,
    debugger: debuggerApi,
  };
  return { wc, debuggerApi };
};

describe('setWebviewLifecycle', () => {
  it('freezes via debugger attach + lifecycle freeze + script-disable and holds the pipe', async () => {
    const { wc, debuggerApi } = makeWc();
    const result = await setWebviewLifecycle(wc, 'frozen');
    expect(result).toEqual({ ok: true, state: 'frozen' });
    expect(debuggerApi.attach).toHaveBeenCalledWith('1.3');
    // Lifecycle freeze first (fires the page's `freeze` event while scripts
    // still run), then the visibility-independent script-disable guarantee.
    expect(debuggerApi.sendCommand.mock.calls).toEqual([
      ['Page.setWebLifecycleState', { state: 'frozen' }],
      ['Emulation.setScriptExecutionDisabled', { value: true }],
    ]);
    // The pipe stays attached while frozen (released on resume).
    expect(debuggerApi.detach).not.toHaveBeenCalled();
  });

  it('mirrors Chrome exemptions: audible and devtools pages are never frozen', async () => {
    const audible = makeWc({ audible: true });
    expect(await setWebviewLifecycle(audible.wc, 'frozen')).toEqual({
      ok: false,
      retryable: true,
      skipped: 'audible',
    });
    expect(audible.debuggerApi.attach).not.toHaveBeenCalled();

    const devtools = makeWc({ devtools: true });
    expect(await setWebviewLifecycle(devtools.wc, 'frozen')).toEqual({
      ok: false,
      retryable: true,
      skipped: 'devtools',
    });
  });

  it('keeps Feishu and Lark collaboration pages active', async () => {
    const urls = [
      'https://bytedance.larkoffice.com/wiki/example',
      'https://team.feishu.cn/docx/example',
      'https://team.larksuite.com/docx/example',
    ];

    for (const url of urls) {
      const { wc, debuggerApi } = makeWc({ url });
      expect(await setWebviewLifecycle(wc, 'frozen')).toEqual({
        ok: false,
        retryable: true,
        skipped: 'always-active',
      });
      expect(debuggerApi.attach).not.toHaveBeenCalled();
    }
  });

  it('evaluates the guest current URL at freeze time after in-page navigation', () => {
    let currentUrl = 'https://example.com/start';
    const { wc } = makeWc({ getUrl: () => currentUrl });
    expect(getWebviewFreezeExemption(wc)).toBeNull();

    currentUrl = 'https://bytedance.larkoffice.com/wiki/navigated';
    expect(getWebviewFreezeExemption(wc)).toEqual({
      ok: false,
      retryable: true,
      skipped: 'always-active',
    });

    currentUrl = 'https://example.com/back';
    expect(getWebviewFreezeExemption(wc)).toBeNull();
  });

  it('fails closed when the guest URL becomes unreadable during teardown', async () => {
    const { wc, debuggerApi } = makeWc({
      getUrl: () => {
        throw new Error('guest destroyed');
      },
    });
    expect(await setWebviewLifecycle(wc, 'frozen')).toEqual({
      ok: false,
      retryable: false,
      skipped: 'destroyed',
    });
    expect(debuggerApi.attach).not.toHaveBeenCalled();
  });

  it('reports destroyed / missing webContents as a non-retryable skip', async () => {
    expect(await setWebviewLifecycle(null, 'frozen')).toEqual({
      ok: false,
      retryable: false,
      skipped: 'destroyed',
    });
    const gone = makeWc({ destroyed: true });
    expect(await setWebviewLifecycle(gone.wc, 'active')).toEqual({
      ok: false,
      retryable: false,
      skipped: 'destroyed',
    });
  });

  it('surfaces an attach conflict (external debugger) as a retryable error', async () => {
    const { wc } = makeWc({ attachError: new Error('Another debugger is already attached') });
    const result = await setWebviewLifecycle(wc, 'frozen');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.retryable).toBe(true);
      expect(result.error).toContain('Another debugger');
      expect(result.skipped).toBeUndefined();
    }
  });

  it('rolls back a half-applied freeze: command failure detaches the pipe', async () => {
    const { wc, debuggerApi } = makeWc({ commandError: new Error('target navigated') });
    const result = await setWebviewLifecycle(wc, 'frozen');
    expect(result.ok).toBe(false);
    // Detach reverts the lifecycle state, clears the emulation override,
    // and frees the pipe for the retry (or DevTools).
    expect(debuggerApi.detach).toHaveBeenCalled();
  });

  it('resume re-enables scripts, sends active, and always releases the debugger pipe', async () => {
    const { wc, debuggerApi } = makeWc({ attached: true });
    const result = await setWebviewLifecycle(wc, 'active');
    expect(result).toEqual({ ok: true, state: 'active' });
    // Scripts first so `resume` event handlers can execute on unfreeze.
    expect(debuggerApi.sendCommand.mock.calls).toEqual([
      ['Emulation.setScriptExecutionDisabled', { value: false }],
      ['Page.setWebLifecycleState', { state: 'active' }],
    ]);
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
