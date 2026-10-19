import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  webContents,
  type IpcMainEvent,
  type WebContents,
} from "electron";

// A page with a `beforeunload` handler (Notion, Google Docs, most editors)
// blocks unload once the user has interacted with it. Chromium would ask the
// user first; Electron instead fires `will-prevent-unload` and, unhandled,
// cancels the reload or navigation without a word, so the toolbar's reload
// looks broken.
//
// Channels (renderer → main, fire-and-forget so they stay ordered before the
// webview call that follows them):
//   iframe:expect-unload  host chrome is about to reload/go back/go forward
//   iframe:allow-unload   the user chose Leave; let the next unload through
// Channel (main → host renderer):
//   iframe:unload-blocked the expected action was vetoed; ask in app chrome
//
// An announced action is cancelled and handed back to the surface, which asks
// in its own UI and replays the action after `allow-unload`. A navigation the
// page starts itself has no surface to replay it, so it keeps the native
// Chrome-style dialog.
const expected = new Set<number>();
const allowed = new Set<number>();

const guestOfSender = (event: IpcMainEvent, payload: unknown): number | null => {
  const id = (payload as { webContentsId?: unknown } | null)?.webContentsId;
  if (typeof id !== "number") return null;
  const guest = webContents.fromId(id);
  return guest?.hostWebContents === event.sender ? id : null;
};

const askNatively = (contents: WebContents): boolean => {
  const host = contents.hostWebContents;
  const win = host && !host.isDestroyed() ? BrowserWindow.fromWebContents(host) : null;
  const zh = app.getLocale().startsWith("zh");
  const options = {
    type: "question" as const,
    buttons: zh ? ["离开", "留在此页"] : ["Leave", "Stay"],
    defaultId: 0,
    cancelId: 1,
    message: zh ? "要离开此网站吗？" : "Leave site?",
    detail: zh ? "系统可能不会保存你所做的更改。" : "Changes you made may not be saved.",
  };
  const choice = win ? dialog.showMessageBoxSync(win, options) : dialog.showMessageBoxSync(options);
  return choice === 0;
};

export function setupUnloadPrompt(): void {
  ipcMain.on("iframe:expect-unload", (event, payload) => {
    const id = guestOfSender(event, payload);
    if (id !== null) expected.add(id);
  });
  ipcMain.on("iframe:allow-unload", (event, payload) => {
    const id = guestOfSender(event, payload);
    if (id !== null) allowed.add(id);
  });

  app.on("web-contents-created", (_event, contents) => {
    if (contents.getType() !== "webview") return;
    const id = contents.id;
    const forget = () => {
      expected.delete(id);
      allowed.delete(id);
    };
    // Once a main-frame navigation starts, the action either passed the page's
    // handler or never met one; stale marks must not leak to a later unload.
    contents.on("did-start-navigation", (_navEvent, _url, isInPlace, isMainFrame) => {
      if (isMainFrame && !isInPlace) forget();
    });
    contents.once("destroyed", forget);

    contents.on("will-prevent-unload", (event) => {
      // preventDefault() ignores the page's beforeunload and lets it unload.
      if (allowed.delete(id)) {
        event.preventDefault();
        return;
      }
      if (expected.delete(id)) {
        const host = contents.hostWebContents;
        if (host && !host.isDestroyed()) {
          host.send("iframe:unload-blocked", { webContentsId: id });
          return;
        }
      }
      if (askNatively(contents)) event.preventDefault();
    });
  });
}
