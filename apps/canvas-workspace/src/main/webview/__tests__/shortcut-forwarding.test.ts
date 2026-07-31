import { describe, expect, it, vi } from 'vitest';
import type { WebContents } from 'electron';
import { isForwardedShortcut } from '../../../shared/webview-shortcuts';
import { WEBVIEW_SHORTCUT_CHANNEL, attachShortcutForwarding } from '../shortcut-forwarding';

interface FakeInput {
  type: string;
  key: string;
  control?: boolean;
  meta?: boolean;
  alt?: boolean;
  shift?: boolean;
}

const createGuest = (host: { send: ReturnType<typeof vi.fn>; isDestroyed: () => boolean } | null) => {
  const listeners: Array<(event: { preventDefault: () => void }, input: FakeInput) => void> = [];
  const guest = {
    hostWebContents: host,
    on: (channel: string, listener: (event: { preventDefault: () => void }, input: FakeInput) => void) => {
      if (channel === 'before-input-event') listeners.push(listener);
      return guest;
    },
  };
  const press = (input: FakeInput) => {
    const event = { preventDefault: vi.fn() };
    const full: FakeInput = { control: false, meta: false, alt: false, shift: false, ...input };
    for (const listener of listeners) listener(event, full);
    return event;
  };
  return { guest: guest as unknown as WebContents, press, listenerCount: () => listeners.length };
};

const createHost = () => ({ send: vi.fn(), isDestroyed: () => false });

describe('isForwardedShortcut', () => {
  it('forwards the app chords a guest would otherwise swallow', () => {
    expect(isForwardedShortcut({ key: 'k', control: false, meta: true, alt: false, shift: false })).toBe(true);
    expect(isForwardedShortcut({ key: 'Escape', control: false, meta: false, alt: false, shift: false })).toBe(true);
    expect(isForwardedShortcut({ key: '3', control: true, meta: false, alt: false, shift: false })).toBe(true);
  });

  // A page legitimately owns these; stealing them would make embedded pages
  // worse than a browser tab.
  it('leaves page-owned keys with the guest', () => {
    expect(isForwardedShortcut({ key: 'f', control: false, meta: true, alt: false, shift: false })).toBe(false);
    expect(isForwardedShortcut({ key: 'c', control: false, meta: true, alt: false, shift: false })).toBe(false);
    expect(isForwardedShortcut({ key: 'ArrowDown', control: false, meta: false, alt: false, shift: false })).toBe(false);
    expect(isForwardedShortcut({ key: 'a', control: false, meta: false, alt: false, shift: false })).toBe(false);
  });

  it('requires exact modifiers', () => {
    // Cmd+Shift+A is a real chord; Cmd+A is the guest's select-all.
    expect(isForwardedShortcut({ key: 'a', control: false, meta: true, alt: false, shift: true })).toBe(true);
    expect(isForwardedShortcut({ key: 'a', control: false, meta: true, alt: false, shift: false })).toBe(false);
  });
});

describe('attachShortcutForwarding', () => {
  it('swallows a whitelisted chord in the guest and hands it to the host', () => {
    const host = createHost();
    const { guest, press } = createGuest(host);
    attachShortcutForwarding(guest);

    const event = press({ type: 'keyDown', key: 'k', meta: true });

    expect(event.preventDefault).toHaveBeenCalledTimes(1);
    expect(host.send).toHaveBeenCalledWith(WEBVIEW_SHORTCUT_CHANNEL, {
      key: 'k',
      control: false,
      meta: true,
      alt: false,
      shift: false,
    });
  });

  it('ignores keyUp and non-whitelisted keys', () => {
    const host = createHost();
    const { guest, press } = createGuest(host);
    attachShortcutForwarding(guest);

    press({ type: 'keyUp', key: 'k', meta: true });
    press({ type: 'keyDown', key: 'f', meta: true });

    expect(host.send).not.toHaveBeenCalled();
  });

  it('never stacks duplicate listeners on the same guest', () => {
    const host = createHost();
    const { guest, press, listenerCount } = createGuest(host);
    attachShortcutForwarding(guest);
    attachShortcutForwarding(guest);

    expect(listenerCount()).toBe(1);
    press({ type: 'keyDown', key: 'Escape' });
    expect(host.send).toHaveBeenCalledTimes(1);
  });

  it('does not throw when the guest has no live host', () => {
    const { guest, press } = createGuest(null);
    attachShortcutForwarding(guest);

    expect(() => press({ type: 'keyDown', key: 'k', meta: true })).not.toThrow();
  });
});
