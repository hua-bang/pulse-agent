// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TERMINAL_ESCAPE_HATCH_MS } from './terminal';
import { createTerminalKeyArbiter, releaseTerminalFocus } from './terminalFocus';

const keydown = (init: KeyboardEventInit & { key: string }) =>
  new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });

let mounted: HTMLElement[] = [];

const mount = <T extends HTMLElement>(element: T): T => {
  document.body.append(element);
  mounted.push(element);
  return element;
};

afterEach(() => {
  for (const element of mounted) element.remove();
  mounted = [];
});

/** Builds an arbiter over a fake xterm plus a real container element. */
const setup = () => {
  const container = mount(document.createElement('div'));
  const term = { blur: vi.fn() };
  let clock = 10_000;
  const arbitrate = createTerminalKeyArbiter({
    getTerminal: () => term,
    getContainer: () => container,
    now: () => clock,
  });
  return {
    term,
    container,
    arbitrate,
    advance: (ms: number) => { clock += ms; },
  };
};

describe('releaseTerminalFocus', () => {
  it('blurs xterm, the container, and the focused helper element', () => {
    const container = mount(document.createElement('div'));
    // xterm's helper element is a textarea that is neither the Terminal nor
    // the container, which is why activeElement is blurred as a backstop.
    const helper = mount(document.createElement('textarea'));
    helper.focus();
    expect(document.activeElement).toBe(helper);
    const term = { blur: vi.fn() };
    const containerBlur = vi.spyOn(container, 'blur');

    releaseTerminalFocus(term, container);

    expect(term.blur).toHaveBeenCalledTimes(1);
    expect(containerBlur).toHaveBeenCalledTimes(1);
    expect(document.activeElement).not.toBe(helper);
  });

  it('is a no-op when the surface is already gone', () => {
    expect(() => releaseTerminalFocus(null, null)).not.toThrow();
    expect(() => releaseTerminalFocus({}, undefined)).not.toThrow();
  });
});

describe('createTerminalKeyArbiter', () => {
  // The reported hole: the coding-agent node and the workspace terminal dock
  // had no keyboard way out of a focused terminal at all.
  it('releases focus on a double Escape and keeps the key from the shell', () => {
    const { arbitrate, term, advance } = setup();

    expect(arbitrate(keydown({ key: 'Escape' }))).toBe(true);
    expect(term.blur).not.toHaveBeenCalled();

    advance(TERMINAL_ESCAPE_HATCH_MS - 1);
    expect(arbitrate(keydown({ key: 'Escape' }))).toBe(false);
    expect(term.blur).toHaveBeenCalledTimes(1);
  });

  // A single Escape belongs to the shell — vim depends on it.
  it('leaves a slow second Escape with the terminal', () => {
    const { arbitrate, term, advance } = setup();

    expect(arbitrate(keydown({ key: 'Escape' }))).toBe(true);
    advance(TERMINAL_ESCAPE_HATCH_MS + 1);
    expect(arbitrate(keydown({ key: 'Escape' }))).toBe(true);
    expect(term.blur).not.toHaveBeenCalled();
  });

  // Without the reset, the Escape after a release would land inside the
  // window of the pair that just fired and blur again immediately.
  it('starts a fresh pair after a release', () => {
    const { arbitrate, term, advance } = setup();

    arbitrate(keydown({ key: 'Escape' }));
    advance(10);
    arbitrate(keydown({ key: 'Escape' }));
    expect(term.blur).toHaveBeenCalledTimes(1);

    advance(10);
    expect(arbitrate(keydown({ key: 'Escape' }))).toBe(true);
    expect(term.blur).toHaveBeenCalledTimes(1);
  });

  // Regression: with a 0 sentinel for "no previous Escape", the first Escape
  // pressed while the clock was still under the hatch window read as the
  // second half of a pair and blurred on its own.
  it('does not release on a first Escape pressed at time zero', () => {
    const container = mount(document.createElement('div'));
    const term = { blur: vi.fn() };
    const arbitrate = createTerminalKeyArbiter({
      getTerminal: () => term,
      getContainer: () => container,
      now: () => 0,
    });

    expect(arbitrate(keydown({ key: 'Escape' }))).toBe(true);
    expect(term.blur).not.toHaveBeenCalled();
  });

  it('keeps Ctrl-chords with the terminal and hands Cmd-chords to the app', () => {
    const { arbitrate } = setup();
    // Ctrl+C interrupt is the terminal's own language.
    expect(arbitrate(keydown({ key: 'c', ctrlKey: true }))).toBe(true);
    // A TTY never sees Cmd, so the app layer may have it.
    expect(arbitrate(keydown({ key: 'k', metaKey: true }))).toBe(false);
  });

  it('reads the terminal lazily, since the handler is attached before it exists', () => {
    const container = mount(document.createElement('div'));
    let term: { blur: ReturnType<typeof vi.fn> } | null = null;
    let clock = 0;
    const arbitrate = createTerminalKeyArbiter({
      getTerminal: () => term,
      getContainer: () => container,
      now: () => clock,
    });

    term = { blur: vi.fn() };
    arbitrate(keydown({ key: 'Escape' }));
    clock += 10;
    arbitrate(keydown({ key: 'Escape' }));

    expect(term.blur).toHaveBeenCalledTimes(1);
  });
});
