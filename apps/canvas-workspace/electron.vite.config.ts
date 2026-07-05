import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import react from "@vitejs/plugin-react";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "fs";

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

/** First (or first two, if scoped) path segment after the last
 *  `node_modules/` in a Rollup module id — the same package-name
 *  extraction bundle-boundaries.test.ts uses for its import-graph gate. */
function packageNameFromModuleId(id: string): string | null {
  const marker = "node_modules/";
  const idx = id.lastIndexOf(marker);
  if (idx === -1) return null;
  const parts = id.slice(idx + marker.length).split("/");
  return parts[0].startsWith("@") ? `${parts[0]}/${parts[1]}` : parts[0];
}

/**
 * A5: per-dependency byte attribution inside the entry chunk. Opt-in via
 * PULSE_CANVAS_PERF_ANALYZE=1 (set by scripts/perf/bundle-report.mjs) —
 * a normal build pays nothing beyond a no-op hook. Reads Rollup's own
 * per-chunk module render stats (chunk.modules[id].renderedLength,
 * pre-minification but post-tree-shake) rather than adding a new
 * dependency (rollup-plugin-visualizer et al) for what's already exposed
 * through the plugin API.
 */
function entryDepStatsPlugin() {
  return {
    name: "pulse-canvas-entry-dep-stats",
    generateBundle(_options: unknown, bundle: Record<string, { type: string; isEntry?: boolean; fileName: string; modules?: Record<string, { renderedLength: number }> }>) {
      if (process.env.PULSE_CANVAS_PERF_ANALYZE !== "1") return;
      for (const chunk of Object.values(bundle)) {
        if (chunk.type !== "chunk" || !chunk.isEntry) continue;
        const byPackage: Record<string, number> = {};
        let appOwnBytes = 0;
        for (const [moduleId, mod] of Object.entries(chunk.modules ?? {})) {
          const pkg = packageNameFromModuleId(moduleId);
          const bytes = mod.renderedLength ?? 0;
          if (pkg) byPackage[pkg] = (byPackage[pkg] ?? 0) + bytes;
          else appOwnBytes += bytes;
        }
        const outDir = new URL("./perf/out/", import.meta.url);
        mkdirSync(outDir, { recursive: true });
        writeFileSync(
          new URL("entry-dep-stats.json", outDir),
          JSON.stringify({ chunkFileName: chunk.fileName, byPackage, appOwnBytes }, null, 2),
        );
      }
    },
  };
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

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
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
    build: {
      outDir: "dist/renderer"
    },
    plugins: [react(), localPluginRendererAssetsPlugin(), entryDepStatsPlugin()]
  }
});
