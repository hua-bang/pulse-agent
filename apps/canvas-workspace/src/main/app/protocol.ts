import { net, protocol } from "electron";
import { isAbsolute, normalize } from "path";
import { pathToFileURL } from "url";
import type { WriteLog } from "./logging";

// Custom scheme for serving local image/file assets to the renderer.
// Chromium blocks `file://` URLs in renderer-loaded pages for security
// reasons, so any <img src="file://..."> from disk fails to load. We expose
// the same bytes under `pulse-canvas://local/<absolute-path>` so the
// renderer can reference local files without disabling webSecurity.
//
// This MUST run before `app.whenReady()`. Privileged scheme registration
// is only effective during app startup.
export function registerPulseCanvasSchemesAsPrivileged(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: "pulse-canvas",
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        stream: true,
        bypassCSP: true,
      },
    },
  ]);
}

export function registerPulseCanvasProtocol(writeLog: WriteLog): void {
  protocol.handle("pulse-canvas", async (request) => {
    try {
      const url = new URL(request.url);
      if (url.hostname !== "local") {
        return new Response("Unsupported host", { status: 400 });
      }
      // pathname is like "/Users/foo/.pulse-coder/canvas/ws-x/images/img.png":
      // percent-decode each segment, then join with the platform separator.
      const segments = url.pathname.split("/").map((s) => {
        try {
          return decodeURIComponent(s);
        } catch {
          return s;
        }
      });
      const joined = segments.join("/");
      const normalized = normalize(joined);
      if (!isAbsolute(normalized)) {
        return new Response("Path must be absolute", { status: 400 });
      }
      // Reject path traversal attempts after normalization.
      if (normalized.includes("..")) {
        return new Response("Forbidden", { status: 403 });
      }
      // Defer existence checks to fetch; it returns the right status code.
      return net.fetch(pathToFileURL(normalized).toString());
    } catch (error) {
      void writeLog("protocol", "pulse-canvas handler failed", String(error));
      return new Response("Internal error", { status: 500 });
    }
  });
}
