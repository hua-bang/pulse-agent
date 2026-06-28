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

createRoot(root).render(
  <Router hook={useHashLocation}>
    <App />
  </Router>,
);

performance.mark("renderer:firstRender");
