import { createRoot } from "react-dom/client";
import { Router, type AroundNavHandler } from "wouter";
import { useHashLocation } from "wouter/use-hash-location";
import App from "./app/App";
import "./styles.css";
import {
  activateConfiguredFederatedRendererPlugins,
  activateCanvasPlugins,
  BUILT_IN_RENDERER_PLUGINS,
} from "../../plugins/renderer";
import { installPerfMonitor, markOnce } from "./perf/monitor";
import { installJankMonitor } from "./perf/jank-monitor";
import { installBeforeQuitFlush } from "./modules/canvas/document/beforeQuit";
import { runViewTransition } from "./shared/viewTransition";
import { installTheme } from "./shared/theme";
import { getInitialLanguage } from "./i18n";
import { loadMessages } from "./i18n/messages";

installTheme();
installPerfMonitor();
installJankMonitor();
installBeforeQuitFlush();
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

// Every route change cross-fades the old page into the new one.
const aroundNav: AroundNavHandler = (navigate, to, options) => {
  runViewTransition(() => navigate(to, options));
};

// A non-English catalog is a separate chunk. Load it before the first render
// so the first frame is already in the user's language.
void loadMessages(getInitialLanguage())
  .catch((err) => console.error('[i18n] failed to load the initial language', err))
  .then(() => {
    markOnce("renderer:render-called");
    createRoot(root).render(
      <Router hook={useHashLocation} aroundNav={aroundNav}>
        <App />
      </Router>,
    );
    requestAnimationFrame(() => markOnce("renderer:first-frame"));
  });
