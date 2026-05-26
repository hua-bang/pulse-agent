import { describe, it, expect } from 'vitest';
import {
  buildClickScript,
  buildEvalScript,
  buildFillScript,
  buildPressScript,
  buildProbeScript,
  buildScrollScript,
  clickSelector,
  evalInPage,
  fillSelector,
  pressKey,
  resolveKeySpec,
  scrollPage,
  waitForCondition,
  type PageRunner,
} from '../js-primitives';

/**
 * Stub PageRunner that returns whatever the caller programs. Lets tests
 * exercise the primitives' control flow without touching electron.
 */
function makeRunner(
  responder: (code: string) => unknown | Promise<unknown>,
): PageRunner & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    async executeJavaScript(code: string): Promise<unknown> {
      calls.push(code);
      return await responder(code);
    },
  };
}

describe('script builders', () => {
  it('lit() escapes user-supplied selector strings safely', () => {
    // A malicious selector should land inside a JSON string literal, not
    // as bare JS. The "alert(1)" payload will appear in the script source
    // (inside the literal) but never as parseable code.
    const payload = 'a[href="\'"]; alert(1); //';
    const script = buildClickScript(payload);
    // The full payload is JSON-encoded — that's the safety guarantee.
    expect(script).toContain(JSON.stringify(payload));
    // And the script must actually parse as valid JS (proves no literal escape).
    expect(() => new Function(script)).not.toThrow();
    // Smoke check: U+2028/U+2029 chars in input are escape-encoded.
    const lsPayload = `pre${String.fromCharCode(0x2028)}post`;
    const lsScript = buildClickScript(lsPayload);
    expect(lsScript).not.toContain(String.fromCharCode(0x2028));
    expect(lsScript).toContain('\\u2028');
    expect(() => new Function(lsScript)).not.toThrow();
  });

  it('buildEvalScript wraps user code in a result envelope', () => {
    const script = buildEvalScript('return 1 + 2');
    expect(script).toContain('return 1 + 2');
    expect(script).toContain('ok: true');
    expect(script).toContain('ok: false');
  });

  it('buildFillScript embeds the value as a JSON literal', () => {
    const script = buildFillScript('input', 'hello "world"');
    expect(script).toContain(JSON.stringify('hello "world"'));
  });

  it('buildPressScript embeds the key spec as a JSON literal', () => {
    const script = buildPressScript({ key: 'Enter', code: 'Enter', keyCode: 13 }, undefined);
    expect(script).toContain('keydown');
    expect(script).toContain('keyup');
    expect(script).toContain('"Enter"');
  });

  it('buildProbeScript requires a selector or predicate', () => {
    const sel = buildProbeScript('div.ready', undefined);
    expect(sel).toContain('querySelector');
    const pred = buildProbeScript(undefined, 'return location.pathname === "/done"');
    expect(pred).toContain('location.pathname');
  });
});

describe('resolveKeySpec', () => {
  it('maps named special keys', () => {
    expect(resolveKeySpec('Enter')).toEqual({ key: 'Enter', code: 'Enter', keyCode: 13 });
    expect(resolveKeySpec('Tab')).toEqual({ key: 'Tab', code: 'Tab', keyCode: 9 });
    expect(resolveKeySpec('ArrowDown')).toEqual({ key: 'ArrowDown', code: 'ArrowDown', keyCode: 40 });
  });

  it('maps single characters with legacy-uppercase keyCode for letters', () => {
    // keyCode follows the legacy physical-key convention: both 'a' and 'A'
    // produce keyCode 65, matching what older shortcut handlers expect.
    expect(resolveKeySpec('a')).toEqual({ key: 'a', code: 'KeyA', keyCode: 65 });
    expect(resolveKeySpec('A')).toEqual({ key: 'A', code: 'KeyA', keyCode: 65 });
    expect(resolveKeySpec('Z')).toEqual({ key: 'Z', code: 'KeyZ', keyCode: 90 });
    expect(resolveKeySpec('z')).toEqual({ key: 'z', code: 'KeyZ', keyCode: 90 });
    expect(resolveKeySpec('5')).toEqual({ key: '5', code: 'Digit5', keyCode: 53 });
  });

  it('returns null for unknown multi-char keys', () => {
    expect(resolveKeySpec('Whatever')).toBeNull();
    expect(resolveKeySpec('F1')).toBeNull();
  });
});

describe('evalInPage', () => {
  it('returns the script value on success', async () => {
    const runner = makeRunner(() => ({ ok: true, value: 42 }));
    const result = await evalInPage(runner, 'return 42');
    expect(result.ok).toBe(true);
    expect(result.data?.value).toBe(42);
  });

  it('surfaces the script-side error on failure', async () => {
    const runner = makeRunner(() => ({ ok: false, error: 'boom' }));
    const result = await evalInPage(runner, 'throw new Error("boom")');
    expect(result.ok).toBe(false);
    expect(result.error).toBe('boom');
  });

  it('flags timeouts distinctly', async () => {
    const runner = makeRunner(
      () =>
        new Promise(() => {
          /* never resolves */
        }),
    );
    const result = await evalInPage(runner, 'while(1){}', 50);
    expect(result.ok).toBe(false);
    expect(result.timedOut).toBe(true);
  });
});

describe('clickSelector', () => {
  it('returns tag/text on success', async () => {
    const runner = makeRunner(() => ({ ok: true, tag: 'button', text: 'Submit' }));
    const r = await clickSelector(runner, 'button');
    expect(r.ok).toBe(true);
    expect(r.data).toEqual({ tag: 'button', text: 'Submit' });
  });

  it('surfaces missing-selector errors', async () => {
    const runner = makeRunner(() => ({ ok: false, error: 'selector not found: x' }));
    const r = await clickSelector(runner, 'x');
    expect(r.ok).toBe(false);
    expect(r.error).toContain('selector not found');
  });
});

describe('fillSelector', () => {
  it('returns mode on success', async () => {
    const runner = makeRunner(() => ({ ok: true, mode: 'value', tag: 'input' }));
    const r = await fillSelector(runner, 'input[name=q]', 'hello');
    expect(r.ok).toBe(true);
    expect(r.data).toEqual({ tag: 'input', mode: 'value' });
  });
});

describe('pressKey', () => {
  it('rejects unsupported keys before talking to the runner', async () => {
    let called = false;
    const runner = makeRunner(() => {
      called = true;
      return { ok: true };
    });
    const r = await pressKey(runner, 'Whatever', undefined);
    expect(r.ok).toBe(false);
    expect(r.error).toContain('unsupported');
    expect(called).toBe(false);
  });

  it('forwards a resolved key spec', async () => {
    const runner = makeRunner(() => ({ ok: true, key: 'Enter' }));
    const r = await pressKey(runner, 'Enter', undefined);
    expect(r.ok).toBe(true);
    expect(r.data?.key).toBe('Enter');
    expect(runner.calls[0]).toContain('"Enter"');
    expect(runner.calls[0]).toContain('keydown');
  });
});

describe('waitForCondition', () => {
  it('resolves as soon as the probe matches', async () => {
    let calls = 0;
    const runner = makeRunner(() => {
      calls += 1;
      return { ok: true, matched: calls >= 3 };
    });
    const r = await waitForCondition(runner, { selector: '.done', intervalMs: 5, timeoutMs: 1000 });
    expect(r.ok).toBe(true);
    expect(r.data?.attempts).toBe(3);
  });

  it('times out when the probe never matches', async () => {
    const runner = makeRunner(() => ({ ok: true, matched: false }));
    const r = await waitForCondition(runner, { selector: '.never', intervalMs: 10, timeoutMs: 50 });
    expect(r.ok).toBe(false);
    expect(r.timedOut).toBe(true);
  });

  it('requires selector or predicate', async () => {
    const runner = makeRunner(() => ({ ok: true, matched: true }));
    const r = await waitForCondition(runner, { timeoutMs: 100 });
    expect(r.ok).toBe(false);
    expect(r.error).toContain('selector or predicate');
  });

  it('surfaces the last probe error on timeout', async () => {
    const runner = makeRunner(() => ({ ok: false, error: 'probe blew up' }));
    const r = await waitForCondition(runner, { selector: '.x', intervalMs: 10, timeoutMs: 30 });
    expect(r.ok).toBe(false);
    expect(r.timedOut).toBe(true);
    expect(r.error).toContain('probe blew up');
  });

  it('enforces a per-probe timeout so a hung predicate does not block forever', async () => {
    // First probe never resolves. With per-probe timeout enforced, the
    // outer wait should still return within roughly timeoutMs and surface
    // the per-probe timeout as the last error.
    const runner = makeRunner(
      () =>
        new Promise(() => {
          /* never resolves */
        }),
    );
    const start = Date.now();
    const r = await waitForCondition(runner, {
      predicate: 'while(1){}; return false',
      timeoutMs: 200,
      intervalMs: 50,
    });
    const elapsed = Date.now() - start;
    expect(r.ok).toBe(false);
    expect(r.timedOut).toBe(true);
    expect(elapsed).toBeLessThan(600); // sanity: didn't hang
  });

  it('aborts immediately when abortCheck returns a reason', async () => {
    let calls = 0;
    const runner = makeRunner(() => {
      calls += 1;
      return { ok: true, matched: false };
    });
    const r = await waitForCondition(runner, {
      selector: '.x',
      timeoutMs: 1000,
      intervalMs: 10,
      abortCheck: () => (calls >= 2 ? 'policy changed mid-wait' : null),
    });
    expect(r.ok).toBe(false);
    expect(r.error).toBe('policy changed mid-wait');
    // abortCheck fires BEFORE the probe each iteration, so we abort
    // before running probe #3.
    expect(calls).toBe(2);
  });
});

describe('evalInPage — non-serialisable results', () => {
  it('rejects BigInt values with a structured error', async () => {
    const runner = makeRunner(() => ({ ok: true, value: 1n }));
    const r = await evalInPage(runner, 'return 1n');
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/not JSON-serialisable/);
  });

  it('rejects cyclic values with a structured error', async () => {
    const cycle: Record<string, unknown> = {};
    cycle.self = cycle;
    const runner = makeRunner(() => ({ ok: true, value: cycle }));
    const r = await evalInPage(runner, 'var x={}; x.self=x; return x');
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/not JSON-serialisable/);
  });

  it('accepts plain JSON-friendly values', async () => {
    const runner = makeRunner(() => ({ ok: true, value: { a: 1, b: [2, 'three'] } }));
    const r = await evalInPage(runner, 'return { a: 1, b: [2, "three"] }');
    expect(r.ok).toBe(true);
    expect(r.data?.value).toEqual({ a: 1, b: [2, 'three'] });
  });
});

describe('scrollPage', () => {
  it('rejects calls with no target before talking to the runner', async () => {
    let called = false;
    const runner = makeRunner(() => {
      called = true;
      return { ok: true };
    });
    const r = await scrollPage(runner, {});
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/top, bottom, selector/);
    expect(called).toBe(false);
  });

  it('scrolls to top and returns the resulting position', async () => {
    const runner = makeRunner(() => ({
      ok: true,
      scrollX: 0,
      scrollY: 0,
      scrollHeight: 5000,
      innerHeight: 800,
      atTop: true,
      atBottom: false,
    }));
    const r = await scrollPage(runner, { top: true });
    expect(r.ok).toBe(true);
    expect(r.data).toMatchObject({ scrollY: 0, atTop: true, atBottom: false });
  });

  it('scrolls by a relative offset', async () => {
    const runner = makeRunner(() => ({
      ok: true,
      scrollX: 0,
      scrollY: 800,
      scrollHeight: 5000,
      innerHeight: 800,
      atTop: false,
      atBottom: false,
    }));
    const r = await scrollPage(runner, { by: { y: 800 } });
    expect(r.ok).toBe(true);
    expect(r.data?.scrollY).toBe(800);
  });

  it('reports the selector when scrollIntoView misses', async () => {
    const runner = makeRunner(() => ({ ok: false, error: 'selector not found: .missing' }));
    const r = await scrollPage(runner, { selector: '.missing' });
    expect(r.ok).toBe(false);
    expect(r.error).toContain('selector not found');
  });
});

describe('buildScrollScript', () => {
  it('embeds the spec as a JSON literal', () => {
    const script = buildScrollScript({ selector: '#footer', block: 'end' });
    expect(script).toContain(JSON.stringify({ selector: '#footer', block: 'end' }));
    expect(script).toContain('scrollIntoView');
  });

  it('is JS-parse-clean against hostile selectors', () => {
    const script = buildScrollScript({ selector: 'a"); alert(1); //' });
    expect(() => new Function(script)).not.toThrow();
  });
});
