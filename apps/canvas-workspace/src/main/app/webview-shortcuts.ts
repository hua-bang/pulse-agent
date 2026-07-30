/**
 * Browsing-shortcut relay for embedded pages.
 *
 * A `<webview>` guest is its own WebContents, so while the user is reading a
 * page the host window never sees `keydown` — ⌘W, ⌘T, ⌘L and friends would
 * silently do nothing (or worse, be swallowed by the site) exactly when the
 * user is most likely to reach for them. `before-input-event` fires in main
 * BEFORE the guest's renderer handles the key, so the chord is resolved here
 * against the shared policy and forwarded to the embedder as `dock:shortcut`.
 *
 * Only chords the dock actually owns are intercepted; everything else reaches
 * the page untouched, including ⌘C/⌘V and any site-defined shortcut.
 */
import { app, type WebContents } from "electron";
import { resolveDockBrowserCommand } from "../../shared/dock-shortcuts";

export function setupWebviewShortcuts(): void {
  app.on("web-contents-created", (_event, contents) => {
    if (contents.getType() !== "webview") return;
    contents.on("before-input-event", (event, input) => {
      // keyUp would double-fire the command for one physical press.
      if (input.type !== "keyDown" || !input.key) return;
      const command = resolveDockBrowserCommand({
        key: input.key,
        metaKey: input.meta,
        ctrlKey: input.control,
        shiftKey: input.shift,
        altKey: input.alt,
      });
      if (!command) return;
      const target = embedderOf(contents);
      if (!target) return;
      event.preventDefault();
      target.send("dock:shortcut", { command });
    });
  });
}

function embedderOf(contents: WebContents): WebContents | null {
  const host = contents.hostWebContents;
  return host && !host.isDestroyed() ? host : null;
}
