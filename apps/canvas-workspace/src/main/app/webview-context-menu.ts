/**
 * Right-click relay for embedded pages.
 *
 * Same shape as the shortcut relay next door and for the same reason: the
 * guest is a separate WebContents, so its `context-menu` event never reaches
 * the window hosting the dock. Forwarding the parameters lets the owning tab
 * draw the menu in app chrome — with the actions that make sense here (open
 * in a background tab, copy an address) rather than Chromium's defaults.
 *
 * `event.preventDefault()` is deliberately NOT called: Electron shows no
 * menu of its own unless the app builds one, so there is nothing to suppress.
 */
import { app } from "electron";
import type { WebviewContextMenuRequest } from "../../shared/webview-context-menu";

export function setupWebviewContextMenu(): void {
  app.on("web-contents-created", (_event, contents) => {
    if (contents.getType() !== "webview") return;
    contents.on("context-menu", (_menuEvent, params) => {
      const target = contents.hostWebContents;
      if (!target || target.isDestroyed()) return;
      const request: WebviewContextMenuRequest = {
        sourceWebContentsId: contents.id,
        x: params.x,
        y: params.y,
        linkURL: params.linkURL,
        srcURL: params.srcURL,
        mediaType: params.mediaType,
        selectionText: params.selectionText,
        isEditable: params.isEditable,
      };
      target.send("webview:context-menu", request);
    });
  });
}
