import { createRoot } from "react-dom/client";
import { Router } from "wouter";
import { useHashLocation } from "wouter/use-hash-location";
import App from "./App";
import "@xterm/xterm/css/xterm.css";
import "./styles.css";
import {
  activateCanvasPlugins,
  BUILT_IN_RENDERER_PLUGINS,
} from "../../plugins/renderer";

const root = document.getElementById("root");
console.log("Renderer bootstrap", { rootFound: Boolean(root) });

if (!root) {
  throw new Error("Root element not found");
}

// Activate renderer-side built-in plugins synchronously before the first
// React render so any registered routes / chat cards are visible to the
// host on initial mount.
activateCanvasPlugins(BUILT_IN_RENDERER_PLUGINS);

createRoot(root).render(
  <Router hook={useHashLocation}>
    <App />
  </Router>,
);
