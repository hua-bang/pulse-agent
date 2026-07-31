/**
 * Keyboard escape hatch for embedded `<webview>` guests.
 *
 * A guest runs in its own renderer process, so once the user clicks into an
 * embedded page every host-window `keydown` listener stops seeing keys: the
 * command palette, workspace switching, canvas zoom, and even Escape went
 * dead, with the mouse as the only way back out.
 *
 * `before-input-event` fires in main for each guest keystroke, which is the
 * one place that can see them. For the narrow whitelist in
 * `shared/webview-shortcuts.ts` we swallow the key and hand it to the host
 * renderer, which re-dispatches it as an ordinary `keydown` so the normal
 * shortcut dispatcher handles it. Everything else — find-in-page, copy,
 * arrows — is left to the guest untouched.
 */
import type { WebContents } from 'electron';
import {
  isForwardedShortcut,
  type ForwardedShortcut,
} from '../../shared/webview-shortcuts';

export const WEBVIEW_SHORTCUT_CHANNEL = 'iframe:shortcut';

/**
 * Guests we have already hooked. A WeakSet so a destroyed guest drops out
 * with no bookkeeping — re-registration of the same node id reuses the same
 * webContents and must not stack duplicate listeners.
 */
const hooked = new WeakSet<WebContents>();

export function attachShortcutForwarding(guest: WebContents | null | undefined): void {
  if (!guest || hooked.has(guest)) return;
  hooked.add(guest);

  guest.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return;
    if (!input.key) return;
    if (!isForwardedShortcut({
      key: input.key,
      control: input.control,
      meta: input.meta,
      alt: input.alt,
      shift: input.shift,
    })) return;

    const host = guest.hostWebContents;
    if (!host || host.isDestroyed()) return;

    // Swallow it in the guest FIRST: forwarding without this would let the
    // page act on the key as well (Cmd+0 resetting the page's own zoom, a
    // web app treating Escape as "close my modal") on top of the host action.
    event.preventDefault();
    const payload: ForwardedShortcut = {
      key: input.key,
      control: input.control,
      meta: input.meta,
      alt: input.alt,
      shift: input.shift,
    };
    host.send(WEBVIEW_SHORTCUT_CHANNEL, payload);
  });
}
