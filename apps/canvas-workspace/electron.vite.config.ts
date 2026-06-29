import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import react from "@vitejs/plugin-react";
import { visualizer } from "rollup-plugin-visualizer";
import { existsSync, readdirSync, readFileSync } from "fs";

const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")) as {
  version: string;
};

type LocalPluginRendererAsset = {
  publicPath: string;
  fileName: string;
  sourcePath: URL;
};

type LocalPluginManifest = {
  nodes?: Array<{
    renderer?: {
      entry?: unknown;
    };
  }>;
};

function fileNameFromEntry(entry: string): string {
  return entry.split(/[\\/]/).filter(Boolean).pop() || "remoteEntry.js";
}

function discoverLocalPluginRendererAssets(): LocalPluginRendererAsset[] {
  const pluginsRoot = new URL("./src/plugins/", import.meta.url);
  const assets: LocalPluginRendererAsset[] = [];
  const seen = new Set<string>();

  for (const entry of readdirSync(pluginsRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;

    const manifestPath = new URL(`${entry.name}/manifest.json`, pluginsRoot);
    if (!existsSync(manifestPath)) continue;

    const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as LocalPluginManifest;
    for (const node of manifest.nodes ?? []) {
      const rendererEntry = node.renderer?.entry;
      if (typeof rendererEntry !== "string" || !rendererEntry.trim()) continue;

      const remoteFileName = fileNameFromEntry(rendererEntry);
      const asset = {
        publicPath: `/plugins/${entry.name}/${remoteFileName}`,
        fileName: `plugins/${entry.name}/${remoteFileName}`,
        sourcePath: new URL(`${entry.name}/${rendererEntry}`, pluginsRoot),
      };
      const key = `${asset.fileName}:${asset.sourcePath.href}`;
      if (seen.has(key)) continue;
      seen.add(key);
      assets.push(asset);
    }
  }

  return assets;
}

function localPluginRendererAssetsPlugin() {
  const assets = discoverLocalPluginRendererAssets();

  return {
    name: "pulse-canvas-local-plugin-renderer-assets",
    configureServer(server) {
      for (const asset of assets) {
        server.middlewares.use(asset.publicPath, (_req, res) => {
          if (!existsSync(asset.sourcePath)) {
            res.statusCode = 404;
            res.end(`plugin renderer asset not found: ${asset.publicPath}`);
            return;
          }
          res.setHeader("Content-Type", "application/javascript; charset=utf-8");
          res.end(readFileSync(asset.sourcePath, "utf8"));
        });
      }
    },
    generateBundle() {
      for (const asset of assets) {
        this.emitFile({
          type: "asset",
          fileName: asset.fileName,
          source: readFileSync(asset.sourcePath, "utf8"),
        });
      }
    },
  };
}

export default defineConfig(({ command }) => {
  // Perf debug tooling (the /perf panel + startup marks) is compiled in for
  // dev and stripped from production builds via the __PERF_TOOLS__ constant.
  // Override with PULSE_PERF_TOOLS=1 to include it in a build (e.g. to run L4
  // runtime profiling against a packaged app).
  const includePerfTools = process.env.PULSE_PERF_TOOLS === "1" || command !== "build";
  const perfDefine = { __PERF_TOOLS__: JSON.stringify(includePerfTools) };

  return {
  main: {
    plugins: [externalizeDepsPlugin()],
    define: perfDefine,
    build: {
      outDir: "dist/main"
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    define: {
      __APP_VERSION__: JSON.stringify(pkg.version)
    },
    build: {
      outDir: "dist/preload",
      rollupOptions: {
        output: {
          format: "cjs",
          entryFileNames: "index.js"
        }
      }
    }
  },
  renderer: {
    root: "src/renderer",
    define: perfDefine,
    build: {
      outDir: "dist/renderer",
      // Bundle analysis is opt-in (PULSE_PERF_BUNDLE=1) so the normal build
      // path is unaffected. Emits a treemap consumed by scripts/perf/bundle.mjs.
      ...(process.env.PULSE_PERF_BUNDLE
        ? {
            rollupOptions: {
              plugins: [
                visualizer({
                  filename: "perf/out/bundle-treemap.html",
                  template: "treemap",
                  gzipSize: true,
                  brotliSize: true
                })
              ]
            }
          }
        : {})
    },
    plugins: [react(), localPluginRendererAssetsPlugin()]
  }
  };
});
