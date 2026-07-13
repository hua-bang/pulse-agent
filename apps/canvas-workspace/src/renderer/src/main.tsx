import { createRoot } from "react-dom/client";
import { Router } from "wouter";
import { useHashLocation } from "wouter/use-hash-location";
import App from "./App";
import "./styles.css";
import {
  activateConfiguredFederatedRendererPlugins,
  activateCanvasPlugins,
  BUILT_IN_RENDERER_PLUGINS,
} from "../../plugins/renderer";
import { installPerfMonitor, markOnce } from "./perf/monitor";
import { installJankMonitor } from "./perf/jank-monitor";

installPerfMonitor();
installJankMonitor();
markOnce("renderer:main-start");

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

markOnce("renderer:render-called");
createRoot(root).render(
  <Router hook={useHashLocation}>
    <App />
  </Router>,
);
requestAnimationFrame(() => markOnce("renderer:first-frame"));
