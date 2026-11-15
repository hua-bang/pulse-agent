// @vitest-environment happy-dom
import { act, useRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useChatShortcuts } from '../useChatShortcuts';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLDivElement | null = null;
const onAbort = vi.fn(async () => true);
const onNewSession = vi.fn();
const windowListener = vi.fn();

interface ProbeProps {
  running: boolean;
  newSession?: boolean;
  ownsPageFocus?: boolean;
  /** Simulates the mention popup consuming Escape first. */
  composerClaimsEscape?: boolean;
}

const Probe = ({ running, newSession = true, ownsPageFocus = false, composerClaimsEscape = false }: ProbeProps) => {
  const rootRef = useRef<HTMLDivElement>(null);
  const editableRef = useRef<HTMLDivElement>(null);
  const onKeyDown = useChatShortcuts({
    rootRef,
    editableRef,
    running,
    onAbort,
    onNewSession: newSession ? onNewSession : undefined,
    composerDisabled: false,
    ownsPageFocus,
  });
  return (
    <div ref={rootRef} onKeyDown={onKeyDown}>
      <button type="button" data-testid="message-action">copy</button>
      <input data-testid="rename" />
      <div
        ref={editableRef}
        data-testid="composer"
        contentEditable
        tabIndex={0}
        onKeyDown={(event) => {
          if (composerClaimsEscape && event.key === 'Escape') event.preventDefault();
        }}
      />
    </div>
  );
};

const render = async (props: ProbeProps) => {
  if (!host) {
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  }
  await act(async () => root?.render(<Probe {...props} />));
};

const byTestId = (id: string): HTMLElement => {
  const element = host?.querySelector<HTMLElement>(`[data-testid="${id}"]`);
  if (!element) throw new Error(`${id} did not mount`);
  return element;
};

const keydown = (target: EventTarget, init: KeyboardEventInit) => {
  const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
  act(() => {
    target.dispatchEvent(event);
  });
  return event;
};

beforeEach(() => {
  window.addEventListener('keydown', windowListener);
});

afterEach(() => {
  window.removeEventListener('keydown', windowListener);
  if (root) act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
  onAbort.mockClear();
  onNewSession.mockClear();
  windowListener.mockClear();
});

describe('chat-scoped shortcuts', () => {
  it('stops a running turn on Escape from the composer and hides the key from window listeners', async () => {
    await render({ running: true });
    const event = keydown(byTestId('composer'), { key: 'Escape' });
    expect(onAbort).toHaveBeenCalledTimes(1);
    expect(event.defaultPrevented).toBe(true);
    expect(windowListener).not.toHaveBeenCalled();
  });

  it('stops a running turn on Mod+. from anywhere inside the chat', async () => {
    await render({ running: true });
    keydown(byTestId('message-action'), { key: '.', metaKey: true });
    expect(onAbort).toHaveBeenCalledTimes(1);
  });

  it('leaves Escape to the canvas/dock when no turn is running', async () => {
    await render({ running: false });
    const event = keydown(byTestId('composer'), { key: 'Escape' });
    expect(onAbort).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
    expect(windowListener).toHaveBeenCalledTimes(1);
  });

  it('does not stop the run when the mention popup used Escape first', async () => {
    await render({ running: true, composerClaimsEscape: true });
    keydown(byTestId('composer'), { key: 'Escape' });
    expect(onAbort).not.toHaveBeenCalled();
  });

  it('leaves Escape in another field (rename input) to that field', async () => {
    await render({ running: true });
    keydown(byTestId('rename'), { key: 'Escape' });
    expect(onAbort).not.toHaveBeenCalled();
  });

  it('starts a new chat on Mod+Shift+O only while allowed', async () => {
    await render({ running: false });
    keydown(byTestId('composer'), { key: 'o', metaKey: true, shiftKey: true });
    expect(onNewSession).toHaveBeenCalledTimes(1);

    await render({ running: false, newSession: false });
    const event = keydown(byTestId('composer'), { key: 'o', metaKey: true, shiftKey: true });
    expect(onNewSession).toHaveBeenCalledTimes(1);
    expect(event.defaultPrevented).toBe(false);
  });

  it('focuses the composer on "/" outside a text field, but types "/" inside one', async () => {
    await render({ running: false });
    const outside = keydown(byTestId('message-action'), { key: '/' });
    expect(document.activeElement).toBe(byTestId('composer'));
    expect(outside.defaultPrevented).toBe(true);

    const inside = keydown(byTestId('composer'), { key: '/' });
    expect(inside.defaultPrevented).toBe(false);
  });

  it('ignores keys typed outside the chat unless it owns page focus', async () => {
    await render({ running: true });
    keydown(document.body, { key: 'Escape' });
    expect(onAbort).not.toHaveBeenCalled();
    // The unclaimed key keeps its global meaning.
    expect(windowListener).toHaveBeenCalledTimes(1);
    windowListener.mockClear();

    await render({ running: true, ownsPageFocus: true });
    const event = keydown(document.body, { key: 'Escape' });
    expect(onAbort).toHaveBeenCalledTimes(1);
    expect(event.defaultPrevented).toBe(true);
    expect(windowListener).not.toHaveBeenCalled();
  });
});
