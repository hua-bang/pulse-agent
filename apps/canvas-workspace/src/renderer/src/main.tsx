import { createRoot } from "react-dom/client";
import { Router } from "wouter";
import { useHashLocation } from "wouter/use-hash-location";
import App from "./App";
import "@xterm/xterm/css/xterm.css";
import "./styles.css";
import {
  activateConfiguredFederatedRendererPlugins,
  activateCanvasPlugins,
  BUILT_IN_RENDERER_PLUGINS,
} from "../../plugins/renderer";

// Startup marks (L3) — cheap, read by the perf panel via the Performance API.
performance.mark("renderer:start");

const root = document.getElementById("root");
console.log("Renderer bootstrap", { rootFound: Boolean(root) });

if (!root) {
  throw new Error("Root element not found");
}

// Activate renderer-side built-in plugins synchronously before the first
// React render so any registered routes / chat cards are visible to the
// host on initial mount.
activateCanvasPlugins(BUILT_IN_RENDERER_PLUGINS);
void activateConfiguredFederatedRendererPlugins().catch((err) => {
  console.error('[canvas-plugins] federated renderer bootstrap failed', err);
});

// Optional perf debug panel. The __PERF_TOOLS__ guard is a build-time literal,
// so production builds dead-code-eliminate this block and never bundle the
// perf plugin (PerfPage + its CSS). Late async registration is fine — the
// /perf route is not on the first-paint path.
if (__PERF_TOOLS__) {
  void import('../../plugins/renderer/perf')
    .then(({ PerfRendererPlugin }) => activateCanvasPlugins([PerfRendererPlugin]))
    .catch((err) => console.error('[canvas-plugins] perf panel bootstrap failed', err));
}

createRoot(root).render(
  <Router hook={useHashLocation}>
    <App />
  </Router>,
);

performance.mark("renderer:firstRender");
