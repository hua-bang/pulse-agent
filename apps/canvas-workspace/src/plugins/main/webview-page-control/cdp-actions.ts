/**
 * CDP-based input primitives for webview iframe nodes.
 *
 * Drop-in upgrades for the JS-based primitives in {@link ./webview-action.ts}:
 *   - JS path: `el.click()` / `dispatchEvent(KeyboardEvent)` — fires at the
 *     top of the JS event stack. React synthetic events see it, but browser
 *     internals don't — `isTrusted` is false, user activation isn't set,
 *     `pointerdown` / hover side effects fire unevenly.
 *   - CDP path: `Input.dispatchMouseEvent` / `Input.dispatchKeyEvent` go
 *     through Chromium's input router below the renderer, the same path
 *     hardware events take. `isTrusted` is true, user activation is set,
 *     so APIs gated on a user gesture (clipboard write, requestFullscreen,
 *     popup blocker bypass) behave correctly. The OS cursor does NOT move
 *     — the synthesis stops at Chromium's input pipeline, by design (we
 *     don't want to hijack the user's physical cursor).
 *
 * All primitives go through {@link withCdp} so they share a single
 * debugger slot with reader code (screenshot, a11y tree) without
 * collisions.
 *
 * Inputs that come from outside (selectors, text, key names) are passed
 * to the guest via CDP command params — never string-concatenated into
 * JS source — so injection is not a concern on this path.
 */

import { withCdp, type CdpHost, type CdpSender } from '../../../main/cdp-session';
import { resolveKeySpec, type PageActionResult, type PageRunner } from './js-primitives';

const DEFAULT_TIMEOUT_MS = 5_000;

// ---------------------------------------------------------------------------
// Modifier bitmask — per CDP `Input.dispatchKeyEvent` / `dispatchMouseEvent`
// ---------------------------------------------------------------------------

export type CdpModifier = 'alt' | 'ctrl' | 'control' | 'meta' | 'cmd' | 'command' | 'shift';

export function modifierMask(mods?: ReadonlyArray<string>): number {
  if (!mods || mods.length === 0) return 0;
  let m = 0;
  for (const raw of mods) {
    const k = String(raw).toLowerCase();
    if (k === 'alt') m |= 1;
    else if (k === 'control' || k === 'ctrl') m |= 2;
    else if (k === 'meta' || k === 'cmd' || k === 'command') m |= 4;
    else if (k === 'shift') m |= 8;
  }
  return m;
}

/**
 * Whether a key event should carry a `text` field (printable input). CDP
 * expects `text` empty for non-printable keys and for chorded combos
 * (Ctrl+A, Cmd+K) — otherwise the page sees Ctrl+A as both a shortcut
 * AND a typed 'a'.
 */
function textFor(keySpec: { key: string; code: string }, modMask: number): string {
  const ctrlOrMeta = (modMask & (2 | 4)) !== 0;
  if (ctrlOrMeta) return '';
  // Single printable char: insert it (respecting shift via the spec.key
  // which is already 'A' vs 'a' for shift-held letters when caller asks).
  if (keySpec.key.length === 1) return keySpec.key;
  // A handful of special keys do generate text in textareas.
  if (keySpec.code === 'Enter') return '\r';
  if (keySpec.code === 'Tab') return '\t';
  return '';
}

async function runWithTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return await Promise.race([
    p,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`CDP action timed out after ${ms}ms`)), ms),
    ),
  ]);
}

// ---------------------------------------------------------------------------
// Selector → coordinate resolution (JS-side, fast, no debugger needed)
// ---------------------------------------------------------------------------

interface CdpActionHost extends CdpHost, PageRunner {}

interface CenterResult {
  ok: boolean;
  x?: number;
  y?: number;
  tag?: string;
  error?: string;
}

/**
 * Scroll the selector into view (if it exists) and return the viewport
 * coordinates of its centre. Runs as a single JS roundtrip so we don't
 * pay debugger-attach overhead just to locate an element.
 */
async function selectorCenter(wc: PageRunner, selector: string): Promise<CenterResult> {
  const script = `(function(){
  try {
    var el = document.querySelector(${JSON.stringify(selector)});
    if (!el) return { ok: false, error: 'selector not found: ' + ${JSON.stringify(selector)} };
    if (typeof el.scrollIntoView === 'function') {
      el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
    }
    var r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) {
      return { ok: false, error: 'element has zero size (likely hidden)' };
    }
    var vw = window.innerWidth, vh = window.innerHeight;
    var cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    if (cx < 0 || cy < 0 || cx > vw || cy > vh) {
      return { ok: false, error: 'element centre is outside viewport (' + Math.round(cx) + ',' + Math.round(cy) + ' vs ' + vw + 'x' + vh + ')' };
    }
    return { ok: true, x: Math.round(cx), y: Math.round(cy), tag: el.tagName.toLowerCase() };
  } catch (e) {
    return { ok: false, error: String(e && e.message || e) };
  }
})()`;
  try {
    return (await wc.executeJavaScript(script, false)) as CenterResult;
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

export interface CdpClickOptions {
  button?: 'left' | 'middle' | 'right';
  clickCount?: number;
  modifiers?: ReadonlyArray<string>;
  timeoutMs?: number;
}

export async function cdpClickAt(
  wc: CdpHost,
  x: number,
  y: number,
  opts: CdpClickOptions = {},
): Promise<PageActionResult> {
  const button = opts.button ?? 'left';
  const clickCount = opts.clickCount ?? 1;
  const mods = modifierMask(opts.modifiers);
  const timeout = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  try {
    return await runWithTimeout(
      withCdp(wc, async (send: CdpSender) => {
        // Move the synthetic cursor first so hover handlers fire correctly
        // before the button-down event. Without this, pages that swap a
        // button's onClick on hover would miss the swap.
        await send('Input.dispatchMouseEvent', {
          type: 'mouseMoved',
          x,
          y,
          modifiers: mods,
          button: 'none',
        });
        await send('Input.dispatchMouseEvent', {
          type: 'mousePressed',
          x,
          y,
          modifiers: mods,
          button,
          clickCount,
        });
        await send('Input.dispatchMouseEvent', {
          type: 'mouseReleased',
          x,
          y,
          modifiers: mods,
          button,
          clickCount,
        });
        return { ok: true, data: { x, y, button } } as PageActionResult;
      }),
      timeout,
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: msg, timedOut: msg.includes('timed out') };
  }
}

export async function cdpClickSelector(
  wc: CdpActionHost,
  selector: string,
  opts: CdpClickOptions = {},
): Promise<PageActionResult> {
  const centre = await selectorCenter(wc, selector);
  if (!centre.ok) return { ok: false, error: centre.error ?? 'selector resolution failed' };
  const result = await cdpClickAt(wc, centre.x!, centre.y!, opts);
  if (result.ok && result.data) {
    return { ok: true, data: { ...result.data, tag: centre.tag, selector } };
  }
  return result;
}

export interface CdpPressOptions {
  selector?: string;
  modifiers?: ReadonlyArray<string>;
  timeoutMs?: number;
}

/**
 * Dispatch a keyDown + keyUp pair via CDP. If a selector is supplied,
 * focus that element first (via JS — focus doesn't need the debugger).
 */
export async function cdpPressKey(
  wc: CdpActionHost,
  key: string,
  opts: CdpPressOptions = {},
): Promise<PageActionResult> {
  const spec = resolveKeySpec(key);
  if (!spec) return { ok: false, error: `unsupported key: "${key}"` };
  const mods = modifierMask(opts.modifiers);
  const timeout = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const text = textFor(spec, mods);

  // Best-effort focus before pressing — JS focus is cheap and avoids
  // bouncing through the debugger when the agent didn't ask for a
  // specific target.
  if (opts.selector) {
    const focusScript = `(function(){
  try {
    var el = document.querySelector(${JSON.stringify(opts.selector)});
    if (!el) return { ok: false, error: 'selector not found for focus' };
    if (typeof el.focus === 'function') el.focus();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e && e.message || e) };
  }
})()`;
    const focusResult = (await wc.executeJavaScript(focusScript, false)) as {
      ok: boolean;
      error?: string;
    };
    if (!focusResult?.ok) {
      return { ok: false, error: focusResult?.error ?? 'focus failed' };
    }
  }

  try {
    return await runWithTimeout(
      withCdp(wc, async (send: CdpSender) => {
        const baseInit: Record<string, unknown> = {
          key: spec.key,
          code: spec.code,
          windowsVirtualKeyCode: spec.keyCode,
          nativeVirtualKeyCode: spec.keyCode,
          modifiers: mods,
        };
        // `rawKeyDown` for non-text keys (modifiers, escape, etc.) +
        // `char` for the actual text. For text-producing keys we send
        // `keyDown` with text — works for normal letter input and forms.
        if (text) {
          await send('Input.dispatchKeyEvent', {
            type: 'keyDown',
            ...baseInit,
            text,
            unmodifiedText: text,
          });
        } else {
          await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...baseInit });
        }
        await send('Input.dispatchKeyEvent', { type: 'keyUp', ...baseInit });
        return { ok: true, data: { key: spec.key, modifiers: mods } } as PageActionResult;
      }),
      timeout,
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: msg, timedOut: msg.includes('timed out') };
  }
}

export interface CdpFillOptions {
  /**
   * Whether to clear the existing value before inserting. Default true —
   * mirrors the previous fillSelector contract that fully replaced the
   * value.
   */
  clearFirst?: boolean;
  timeoutMs?: number;
}

/**
 * Fill an input/textarea/contenteditable with `value` via CDP `Input.insertText`.
 *
 * Strategy:
 *   1. JS: scrollIntoView + focus the element (and clear value if asked).
 *      For React-controlled fields we use the native setter so framework
 *      tracking sees the clear.
 *   2. CDP: `Input.insertText` inserts as if pasted — no per-char keydown,
 *      which is what you usually want for filling forms.
 */
export async function cdpFillSelector(
  wc: CdpActionHost,
  selector: string,
  value: string,
  opts: CdpFillOptions = {},
): Promise<PageActionResult> {
  const clearFirst = opts.clearFirst !== false;
  const timeout = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  const prepScript = `(function(){
  try {
    var el = document.querySelector(${JSON.stringify(selector)});
    if (!el) return { ok: false, error: 'selector not found: ' + ${JSON.stringify(selector)} };
    if (typeof el.scrollIntoView === 'function') {
      el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
    }
    if (typeof el.focus === 'function') el.focus();
    var tag = el.tagName ? el.tagName.toLowerCase() : '';
    if (${clearFirst ? 'true' : 'false'}) {
      if (el.isContentEditable) {
        el.innerText = '';
        el.dispatchEvent(new Event('input', { bubbles: true }));
      } else if (tag === 'input' || tag === 'textarea' || tag === 'select') {
        var proto = tag === 'textarea'
          ? window.HTMLTextAreaElement.prototype
          : (tag === 'select' ? window.HTMLSelectElement.prototype : window.HTMLInputElement.prototype);
        var setter = Object.getOwnPropertyDescriptor(proto, 'value');
        if (setter && setter.set) {
          setter.set.call(el, '');
        } else {
          el.value = '';
        }
        el.dispatchEvent(new Event('input', { bubbles: true }));
      }
    }
    return { ok: true, tag: tag, editable: el.isContentEditable || tag === 'input' || tag === 'textarea' };
  } catch (e) {
    return { ok: false, error: String(e && e.message || e) };
  }
})()`;

  const prep = (await wc.executeJavaScript(prepScript, false)) as {
    ok: boolean;
    tag?: string;
    editable?: boolean;
    error?: string;
  };
  if (!prep?.ok) return { ok: false, error: prep?.error ?? 'fill prep failed' };
  if (!prep.editable) {
    return { ok: false, error: `element is not editable (tag=${prep.tag})` };
  }

  try {
    return await runWithTimeout(
      withCdp(wc, async (send: CdpSender) => {
        await send('Input.insertText', { text: value });
        return {
          ok: true,
          data: { tag: prep.tag, length: value.length, mode: 'insertText' },
        } as PageActionResult;
      }),
      timeout,
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: msg, timedOut: msg.includes('timed out') };
  }
}
