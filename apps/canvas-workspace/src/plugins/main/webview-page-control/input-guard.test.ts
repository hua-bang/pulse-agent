import { describe, expect, it, vi } from 'vitest';
import { withCdp, type CdpHost } from '../../../main/webview/cdp-session';
import { withGuardedCdp } from './input-guard';
import { cdpFillSelector } from './cdp-actions';

function host() {
  let attached = false;
  return {
    debugger: {
      isAttached: () => attached,
      attach: () => { attached = true; },
      detach: () => { attached = false; },
      sendCommand: vi.fn().mockResolvedValue({}),
    },
    executeJavaScript: vi.fn().mockResolvedValue({ ok: true, editable: true, tag: 'input' }),
  };
}

describe('guarded browser input', () => {
  it('releases the CDP lane when a dispatched command never acknowledges cancellation', async () => {
    const wc = host();
    wc.debugger.sendCommand.mockImplementationOnce(() => new Promise(() => {}));
    const controller = new AbortController();
    let stopped = false;
    const first = withGuardedCdp(wc, { signal: controller.signal }, send => send('Input.dispatchMouseEvent', { type: 'mouseMoved' }))
      .catch(() => { stopped = true; });
    await vi.waitFor(() => expect(wc.debugger.sendCommand).toHaveBeenCalledTimes(1));
    controller.abort(new Error('Cancelled'));
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(stopped).toBe(true);
    await first;
    await withGuardedCdp(wc, {}, send => send('Input.insertText', { text: 'next action' }));
    expect(wc.debugger.sendCommand).toHaveBeenCalledTimes(2);
  });

  it('checks cancellation after acquiring the existing CDP mutex', async () => {
    const wc = host();
    let release!: () => void;
    const first = withCdp(wc, () => new Promise<void>(resolve => { release = resolve; }));
    await vi.waitFor(() => expect(release).toBeTypeOf('function'));
    const controller = new AbortController();
    const second = withGuardedCdp(wc, { signal: controller.signal }, send => send('Input.insertText', { text: 'late' }));
    const rejected = expect(second).rejects.toThrow('Cancelled');
    controller.abort(new Error('Cancelled'));
    release();
    await first;
    await rejected;
    expect(wc.debugger.sendCommand).not.toHaveBeenCalled();
  });

  it('rechecks target between input events', async () => {
    const wc: CdpHost = host();
    const guard = vi.fn().mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined).mockRejectedValue(new Error('Target replaced'));
    await expect(withGuardedCdp(wc, { beforeInput: guard }, async send => {
      await send('Input.dispatchMouseEvent', { type: 'mouseMoved' });
      await send('Input.dispatchMouseEvent', { type: 'mousePressed' });
    })).rejects.toThrow('Target replaced');
    expect(wc.debugger.sendCommand).toHaveBeenCalledTimes(1);
  });

  it('checks before fill preparation, so rejected input never clears a field', async () => {
    const wc = host();
    await expect(cdpFillSelector(wc, '#q', 'Pulse', {
      beforeInput: async () => { throw new Error('Stale'); },
    })).rejects.toThrow('Stale');
    expect(wc.executeJavaScript).not.toHaveBeenCalled();
    expect(wc.debugger.sendCommand).not.toHaveBeenCalled();
  });

  it('finishes a validated input pair when pressing changes the page', async () => {
    const wc = host();
    const guard = vi.fn().mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined)
      .mockRejectedValue(new Error('Page changed by the submitted Enter'));
    await withGuardedCdp(wc, { beforeInput: guard }, async send => {
      await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter' });
      await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter' });
    });
    expect(guard).toHaveBeenCalledTimes(2);
    expect(wc.debugger.sendCommand).toHaveBeenCalledTimes(2);
  });
});
