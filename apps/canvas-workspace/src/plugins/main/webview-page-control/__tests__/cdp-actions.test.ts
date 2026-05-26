import { describe, it, expect } from 'vitest';
import {
  cdpClickAt,
  cdpClickSelector,
  cdpFillSelector,
  cdpPressKey,
  modifierMask,
} from '../cdp-actions';
import type { CdpHost } from '../../../../main/webview/cdp-session';

interface FakeHost extends CdpHost {
  executeJavaScript(code: string, userGesture?: boolean): Promise<unknown>;
  cdpCalls: Array<{ method: string; params?: Record<string, unknown> }>;
  jsCalls: string[];
}

function makeHost(opts: {
  jsResponse?: unknown | ((code: string) => unknown);
  cdpResponse?: (method: string, params?: Record<string, unknown>) => unknown;
} = {}): FakeHost {
  let attached = false;
  const cdpCalls: Array<{ method: string; params?: Record<string, unknown> }> = [];
  const jsCalls: string[] = [];
  const host: FakeHost = {
    cdpCalls,
    jsCalls,
    debugger: {
      isAttached: () => attached,
      attach: () => {
        attached = true;
      },
      detach: () => {
        attached = false;
      },
      async sendCommand(method: string, params?: Record<string, unknown>) {
        cdpCalls.push({ method, params });
        return opts.cdpResponse ? opts.cdpResponse(method, params) : {};
      },
    },
    async executeJavaScript(code: string) {
      jsCalls.push(code);
      if (typeof opts.jsResponse === 'function') {
        return (opts.jsResponse as (c: string) => unknown)(code);
      }
      return opts.jsResponse;
    },
  };
  return host;
}

describe('modifierMask', () => {
  it('combines bits per the CDP spec', () => {
    expect(modifierMask([])).toBe(0);
    expect(modifierMask(['alt'])).toBe(1);
    expect(modifierMask(['ctrl'])).toBe(2);
    expect(modifierMask(['control'])).toBe(2);
    expect(modifierMask(['meta'])).toBe(4);
    expect(modifierMask(['cmd'])).toBe(4);
    expect(modifierMask(['command'])).toBe(4);
    expect(modifierMask(['shift'])).toBe(8);
    expect(modifierMask(['ctrl', 'shift'])).toBe(10);
    expect(modifierMask(['meta', 'shift', 'alt'])).toBe(13);
  });

  it('ignores unknown modifier names', () => {
    expect(modifierMask(['weird', 'shift'])).toBe(8);
  });
});

describe('cdpClickAt', () => {
  it('dispatches move + press + release at the given coordinates', async () => {
    const host = makeHost();
    const r = await cdpClickAt(host, 120, 240);
    expect(r.ok).toBe(true);
    expect(r.data).toEqual({ x: 120, y: 240, button: 'left' });
    expect(host.cdpCalls.map((c) => c.method)).toEqual([
      'Input.dispatchMouseEvent',
      'Input.dispatchMouseEvent',
      'Input.dispatchMouseEvent',
    ]);
    expect(host.cdpCalls[0].params).toMatchObject({ type: 'mouseMoved', x: 120, y: 240 });
    expect(host.cdpCalls[1].params).toMatchObject({ type: 'mousePressed', x: 120, y: 240, button: 'left' });
    expect(host.cdpCalls[2].params).toMatchObject({ type: 'mouseReleased', x: 120, y: 240, button: 'left' });
  });

  it('forwards button, clickCount, and modifier mask', async () => {
    const host = makeHost();
    await cdpClickAt(host, 10, 10, {
      button: 'right',
      clickCount: 2,
      modifiers: ['shift', 'meta'],
    });
    expect(host.cdpCalls[1].params).toMatchObject({
      type: 'mousePressed',
      button: 'right',
      clickCount: 2,
      modifiers: 12, // shift(8) + meta(4)
    });
  });

  it('surfaces CDP errors as structured failures', async () => {
    const host = makeHost({
      cdpResponse: (method) => {
        if (method === 'Input.dispatchMouseEvent') throw new Error('bad target');
      },
    });
    const r = await cdpClickAt(host, 1, 1);
    expect(r.ok).toBe(false);
    expect(r.error).toBe('bad target');
  });
});

describe('cdpClickSelector', () => {
  it('resolves selector → centre coords via JS then clicks at centre', async () => {
    const host = makeHost({
      jsResponse: { ok: true, x: 50, y: 60, tag: 'button' },
    });
    const r = await cdpClickSelector(host, 'button.submit');
    expect(r.ok).toBe(true);
    expect(r.data).toMatchObject({ x: 50, y: 60, tag: 'button', selector: 'button.submit' });
    // mousePressed at the centre point returned by the JS probe.
    expect(host.cdpCalls[1].params).toMatchObject({ type: 'mousePressed', x: 50, y: 60 });
  });

  it('reports selector resolution failure without touching CDP', async () => {
    const host = makeHost({
      jsResponse: { ok: false, error: 'selector not found: .nope' },
    });
    const r = await cdpClickSelector(host, '.nope');
    expect(r.ok).toBe(false);
    expect(r.error).toContain('selector not found');
    expect(host.cdpCalls).toHaveLength(0);
  });
});

describe('cdpPressKey', () => {
  it('dispatches keyDown + keyUp for a printable letter with text', async () => {
    const host = makeHost();
    const r = await cdpPressKey(host, 'a');
    expect(r.ok).toBe(true);
    expect(host.cdpCalls).toHaveLength(2);
    // Letter 'a' uses keyDown (text-producing) — no separate rawKeyDown step.
    expect(host.cdpCalls[0].params).toMatchObject({
      type: 'keyDown',
      key: 'a',
      code: 'KeyA',
      windowsVirtualKeyCode: 65,
      text: 'a',
    });
    expect(host.cdpCalls[1].params).toMatchObject({ type: 'keyUp', key: 'a' });
  });

  it('uses rawKeyDown (no text) for special keys like Enter when no Ctrl/Meta is held', async () => {
    const host = makeHost();
    await cdpPressKey(host, 'Enter');
    // Enter generates text '\r' on keyDown so it appears as keyDown, not rawKeyDown.
    expect(host.cdpCalls[0].params).toMatchObject({
      type: 'keyDown',
      key: 'Enter',
      code: 'Enter',
      text: '\r',
    });
  });

  it('uses rawKeyDown with empty text for chord shortcuts like Ctrl+A', async () => {
    const host = makeHost();
    await cdpPressKey(host, 'a', { modifiers: ['ctrl'] });
    // ctrl is held → text must be empty so the page doesn\'t see "ctrl+a" AND a typed 'a'.
    expect(host.cdpCalls[0].params).toMatchObject({
      type: 'rawKeyDown',
      key: 'a',
      modifiers: 2,
    });
    expect(host.cdpCalls[0].params).not.toHaveProperty('text');
  });

  it('focuses the optional selector before pressing', async () => {
    const host = makeHost({
      jsResponse: (code: string) => {
        if (code.includes('focus')) return { ok: true };
        return { ok: false };
      },
    });
    const r = await cdpPressKey(host, 'Enter', { selector: 'input#email' });
    expect(r.ok).toBe(true);
    expect(host.jsCalls[0]).toContain('focus');
    expect(host.jsCalls[0]).toContain('input#email');
  });

  it('rejects unsupported keys before talking to CDP', async () => {
    const host = makeHost();
    const r = await cdpPressKey(host, 'Whatever');
    expect(r.ok).toBe(false);
    expect(r.error).toContain('unsupported');
    expect(host.cdpCalls).toHaveLength(0);
  });
});

describe('cdpFillSelector', () => {
  it('focuses + clears via JS then inserts via CDP Input.insertText', async () => {
    const host = makeHost({
      jsResponse: { ok: true, tag: 'input', editable: true },
    });
    const r = await cdpFillSelector(host, 'input#q', 'hello');
    expect(r.ok).toBe(true);
    expect(r.data).toMatchObject({ tag: 'input', length: 5, mode: 'insertText' });
    expect(host.cdpCalls).toEqual([
      { method: 'Input.insertText', params: { text: 'hello' } },
    ]);
  });

  it('rejects non-editable elements before talking to CDP', async () => {
    const host = makeHost({
      jsResponse: { ok: true, tag: 'div', editable: false },
    });
    const r = await cdpFillSelector(host, 'div.label', 'hello');
    expect(r.ok).toBe(false);
    expect(r.error).toContain('not editable');
    expect(host.cdpCalls).toHaveLength(0);
  });

  it('reports JS-side selector failure without touching CDP', async () => {
    const host = makeHost({
      jsResponse: { ok: false, error: 'selector not found: .nope' },
    });
    const r = await cdpFillSelector(host, '.nope', 'x');
    expect(r.ok).toBe(false);
    expect(r.error).toContain('selector not found');
    expect(host.cdpCalls).toHaveLength(0);
  });
});
