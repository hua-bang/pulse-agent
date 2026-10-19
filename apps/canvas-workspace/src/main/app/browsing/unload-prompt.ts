import { app, BrowserWindow, dialog } from "electron";

// A page with a `beforeunload` handler (Notion, Google Docs, most editors)
// blocks unload once the user has interacted with it. Chromium would ask the
// user first; Electron instead fires `will-prevent-unload` and, unhandled,
// cancels the reload or navigation without a word, so the toolbar's reload
// looks broken. Ask the same question Chrome asks, on the hosting window.
export function setupUnloadPrompt(): void {
  app.on("web-contents-created", (_event, contents) => {
    if (contents.getType() !== "webview") return;
    contents.on("will-prevent-unload", (event) => {
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
      // preventDefault() ignores the page's beforeunload and lets it unload.
      if (choice === 0) event.preventDefault();
    });
  });
}
