/**
 * Low-level page-action primitives executed inside an iframe-node webview.
 *
 * These are the write side of {@link ./webpage-reader-ipc.ts}. They run
 * inside the guest's isolated world via `webContents.executeJavaScript`,
 * so they can't see our renderer globals and the guest can't see us. The
 * tools layer ({@link ./canvas-agent/webview-action-tools.ts}) wraps each
 * primitive with zod schemas, policy enforcement (see
 * {@link ./webview-action-policy.ts}), and an audit log line.
 *
 * Primitives are designed to be testable: each one takes a `WebContents`-
 * shaped object exposing just `executeJavaScript`, and returns a tagged
 * result object. No I/O, no IPC, no electron imports — pure functions
 * over JS source.
 *
 * Notes on the script approach:
 *   - We render the JS body as a single IIFE returning a plain object;
 *     `executeJavaScript` resolves with that object directly.
 *   - We never string-concat untrusted values into the script. Inputs
 *     are JSON-encoded so the guest receives them as literals.
 *   - For React-controlled inputs we use the native setter trick
 *     (Object.getOwnPropertyDescriptor(...).set.call(el, value)) so the
 *     framework's value tracking sees the change.
 */

const DEFAULT_TIMEOUT_MS = 5_000;
const DEFAULT_WAIT_INTERVAL_MS = 100;

/**
 * Minimal `WebContents` shape used by the primitives. Production code
 * passes an Electron `WebContents`; tests pass a stub with just
 * `executeJavaScript`.
 */
export interface PageRunner {
  executeJavaScript(code: string, userGesture?: boolean): Promise<unknown>;
}

export interface PageActionResult {
  ok: boolean;
  /** Free-form data per action — caller serialises to the agent. */
  data?: Record<string, unknown>;
  error?: string;
  /** Set when the failure was caused by the guest-side timeout cap. */
  timedOut?: boolean;
}

async function runWithTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return await Promise.race([
    p,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`action timed out after ${ms}ms`)), ms),
    ),
  ]);
}

// U+2028 (LINE SEPARATOR) and U+2029 (PARAGRAPH SEPARATOR) are line
// terminators in TS/JS source files. JSON.stringify leaves them raw, so
// values containing them break when inlined into a JS IIFE. Build the
// chars via fromCharCode so this source file itself contains zero
// occurrences of the offending codepoints.
const LS = String.fromCharCode(0x2028);
const PS = String.fromCharCode(0x2029);

/** JSON-encode a value for safe inlining into a JS source string. */
function lit(v: unknown): string {
  return JSON.stringify(v).split(LS).join('\\u2028').split(PS).join('\\u2029');
}

/** Build an IIFE returning a JSON-serialisable result object. */
function asIife(body: string): string {
  return `(function(){\n${body}\n})()`;
}

// ---------------------------------------------------------------------------
// Script builders (exported for testing)
// ---------------------------------------------------------------------------

export function buildEvalScript(code: string): string {
  // We wrap the user's code in another IIFE so they can `return` a value.
  // Result is JSON-stringified to a guaranteed-serialisable string for
  // the agent — Electron will JSON.parse() it back to plain data.
  return asIife(`
try {
  var __r = (function(){ ${code} })();
  if (__r && typeof __r.then === 'function') {
    return __r.then(function(v){ return { ok: true, value: v }; },
                    function(e){ return { ok: false, error: String(e && e.message || e) }; });
  }
  return { ok: true, value: __r };
} catch (e) {
  return { ok: false, error: String(e && e.message || e) };
}
`);
}

export function buildClickScript(selector: string): string {
  return asIife(`
try {
  var el = document.querySelector(${lit(selector)});
  if (!el) return { ok: false, error: 'selector not found: ' + ${lit(selector)} };
  if (typeof el.scrollIntoView === 'function') {
    el.scrollIntoView({ block: 'center', inline: 'center' });
  }
  var rect = el.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) {
    return { ok: false, error: 'element is not visible (zero size)' };
  }
  el.click();
  return { ok: true, tag: el.tagName.toLowerCase(), text: (el.innerText || '').slice(0, 200) };
} catch (e) {
  return { ok: false, error: String(e && e.message || e) };
}
`);
}

export function buildFillScript(selector: string, value: string): string {
  return asIife(`
try {
  var el = document.querySelector(${lit(selector)});
  if (!el) return { ok: false, error: 'selector not found: ' + ${lit(selector)} };
  if (typeof el.focus === 'function') el.focus();
  var v = ${lit(value)};
  var tag = el.tagName ? el.tagName.toLowerCase() : '';
  if (el.isContentEditable) {
    el.innerText = v;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    return { ok: true, mode: 'contenteditable', tag: tag };
  }
  if (tag === 'input' || tag === 'textarea' || tag === 'select') {
    var proto = tag === 'textarea'
      ? window.HTMLTextAreaElement.prototype
      : (tag === 'select' ? window.HTMLSelectElement.prototype : window.HTMLInputElement.prototype);
    var setter = Object.getOwnPropertyDescriptor(proto, 'value');
    if (setter && setter.set) {
      setter.set.call(el, v);
    } else {
      el.value = v;
    }
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return { ok: true, mode: 'value', tag: tag };
  }
  return { ok: false, error: 'element is not editable (tag=' + tag + ')' };
} catch (e) {
  return { ok: false, error: String(e && e.message || e) };
}
`);
}

/**
 * Map a high-level key name like "Enter" / "ArrowDown" / "a" to the
 * triple ({ key, code, keyCode }) most apps expect. Returns null for
 * keys we don't have a mapping for — caller surfaces this as an error.
 */
export function resolveKeySpec(key: string): { key: string; code: string; keyCode: number } | null {
  const specials: Record<string, { code: string; keyCode: number }> = {
    Enter: { code: 'Enter', keyCode: 13 },
    Tab: { code: 'Tab', keyCode: 9 },
    Escape: { code: 'Escape', keyCode: 27 },
    Backspace: { code: 'Backspace', keyCode: 8 },
    Delete: { code: 'Delete', keyCode: 46 },
    ArrowUp: { code: 'ArrowUp', keyCode: 38 },
    ArrowDown: { code: 'ArrowDown', keyCode: 40 },
    ArrowLeft: { code: 'ArrowLeft', keyCode: 37 },
    ArrowRight: { code: 'ArrowRight', keyCode: 39 },
    Home: { code: 'Home', keyCode: 36 },
    End: { code: 'End', keyCode: 35 },
    PageUp: { code: 'PageUp', keyCode: 33 },
    PageDown: { code: 'PageDown', keyCode: 34 },
    Space: { code: 'Space', keyCode: 32 },
    ' ': { code: 'Space', keyCode: 32 },
  };
  if (specials[key]) {
    return { key, code: specials[key].code, keyCode: specials[key].keyCode };
  }
  // Single printable character — treat as a literal key. Code is 'KeyX'
  // for letters, 'DigitN' for digits, otherwise empty (apps usually
  // care about `key` rather than `code` for typed text).
  if (key.length === 1) {
    const ch = key;
    const cc = ch.charCodeAt(0);
    let code = '';
    if (/^[a-zA-Z]$/.test(ch)) code = 'Key' + ch.toUpperCase();
    else if (/^[0-9]$/.test(ch)) code = 'Digit' + ch;
    return { key: ch, code, keyCode: cc };
  }
  return null;
}

export function buildPressScript(
  spec: { key: string; code: string; keyCode: number },
  selector: string | undefined,
): string {
  return asIife(`
try {
  var target = ${selector ? `document.querySelector(${lit(selector)})` : 'document.activeElement || document.body'};
  if (!target) return { ok: false, error: 'no target for key event' };
  if (target.focus && typeof target.focus === 'function') target.focus();
  var spec = ${lit(spec)};
  var init = { key: spec.key, code: spec.code, keyCode: spec.keyCode,
               which: spec.keyCode, bubbles: true, cancelable: true };
  target.dispatchEvent(new KeyboardEvent('keydown', init));
  target.dispatchEvent(new KeyboardEvent('keypress', init));
  target.dispatchEvent(new KeyboardEvent('keyup', init));
  return { ok: true, key: spec.key };
} catch (e) {
  return { ok: false, error: String(e && e.message || e) };
}
`);
}

export function buildProbeScript(
  selector: string | undefined,
  predicate: string | undefined,
): string {
  return asIife(`
try {
  ${
    selector
      ? `var el = document.querySelector(${lit(selector)});
         if (!el) return { ok: true, matched: false };
         var rect = el.getBoundingClientRect();
         return { ok: true, matched: rect.width > 0 && rect.height > 0,
                  text: (el.innerText || '').slice(0, 200) };`
      : `var __r = (function(){ ${predicate ?? 'return false;'} })();
         return { ok: true, matched: !!__r };`
  }
} catch (e) {
  return { ok: false, error: String(e && e.message || e) };
}
`);
}

// ---------------------------------------------------------------------------
// Primitives — run the script and shape the result
// ---------------------------------------------------------------------------

export async function evalInPage(
  wc: PageRunner,
  code: string,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<PageActionResult> {
  try {
    const raw = (await runWithTimeout(
      wc.executeJavaScript(buildEvalScript(code), false),
      timeoutMs,
    )) as { ok: boolean; value?: unknown; error?: string };
    if (!raw?.ok) return { ok: false, error: raw?.error ?? 'eval failed' };
    return { ok: true, data: { value: raw.value } };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: msg, timedOut: msg.includes('timed out') };
  }
}

export async function clickSelector(
  wc: PageRunner,
  selector: string,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<PageActionResult> {
  try {
    const raw = (await runWithTimeout(
      wc.executeJavaScript(buildClickScript(selector), true),
      timeoutMs,
    )) as { ok: boolean; tag?: string; text?: string; error?: string };
    if (!raw?.ok) return { ok: false, error: raw?.error ?? 'click failed' };
    return { ok: true, data: { tag: raw.tag, text: raw.text } };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: msg, timedOut: msg.includes('timed out') };
  }
}

export async function fillSelector(
  wc: PageRunner,
  selector: string,
  value: string,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<PageActionResult> {
  try {
    const raw = (await runWithTimeout(
      wc.executeJavaScript(buildFillScript(selector, value), true),
      timeoutMs,
    )) as { ok: boolean; mode?: string; tag?: string; error?: string };
    if (!raw?.ok) return { ok: false, error: raw?.error ?? 'fill failed' };
    return { ok: true, data: { tag: raw.tag, mode: raw.mode } };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: msg, timedOut: msg.includes('timed out') };
  }
}

export async function pressKey(
  wc: PageRunner,
  key: string,
  selector: string | undefined,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<PageActionResult> {
  const spec = resolveKeySpec(key);
  if (!spec) return { ok: false, error: `unsupported key: "${key}"` };
  try {
    const raw = (await runWithTimeout(
      wc.executeJavaScript(buildPressScript(spec, selector), true),
      timeoutMs,
    )) as { ok: boolean; key?: string; error?: string };
    if (!raw?.ok) return { ok: false, error: raw?.error ?? 'press failed' };
    return { ok: true, data: { key: raw.key } };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: msg, timedOut: msg.includes('timed out') };
  }
}

export async function waitForCondition(
  wc: PageRunner,
  opts: { selector?: string; predicate?: string; timeoutMs?: number; intervalMs?: number },
): Promise<PageActionResult> {
  const timeout = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const interval = opts.intervalMs ?? DEFAULT_WAIT_INTERVAL_MS;
  if (!opts.selector && !opts.predicate) {
    return { ok: false, error: 'either selector or predicate must be provided' };
  }
  const deadline = Date.now() + timeout;
  const script = buildProbeScript(opts.selector, opts.predicate);
  let lastError: string | undefined;
  let attempts = 0;
  while (Date.now() < deadline) {
    attempts += 1;
    try {
      const raw = (await wc.executeJavaScript(script, false)) as {
        ok: boolean;
        matched?: boolean;
        text?: string;
        error?: string;
      };
      if (!raw?.ok) {
        lastError = raw?.error ?? 'probe error';
      } else if (raw.matched) {
        return { ok: true, data: { attempts, text: raw.text } };
      }
    } catch (e) {
      lastError = e instanceof Error ? e.message : String(e);
    }
    if (Date.now() + interval >= deadline) break;
    await new Promise((r) => setTimeout(r, interval));
  }
  return {
    ok: false,
    timedOut: true,
    error: lastError
      ? `condition not met within ${timeout}ms (last error: ${lastError})`
      : `condition not met within ${timeout}ms (${attempts} attempts)`,
  };
}
