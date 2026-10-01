import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

/**
 * Builds the MCP App node view (`src/renderer/node-view.html`) into one
 * self-contained HTML file. MCP App resources run in a sandboxed iframe with
 * no network or same-origin server, so every script, stylesheet, and font is
 * inlined. Packaging ships the file next to the bundled canvas-cli, where
 * `pulse-canvas mcp` serves it as `ui://pulse-canvas/node.html`.
 */
function inlineSingleFile(): Plugin {
  return {
    name: "pulse-node-view-inline",
    enforce: "post",
    // writeBundle sees the final chunk code (Vite resolves its preload
    // markers late in generateBundle), so inlining happens on the written files.
    writeBundle(options, bundle) {
      const outDir = options.dir!;
      const htmlName = Object.keys(bundle).find((fileName) => fileName.endsWith(".html"));
      if (!htmlName) return;
      let html = readFileSync(join(outDir, htmlName), "utf8");
      for (const [fileName, item] of Object.entries(bundle)) {
        if (item.type === "chunk" && item.isEntry) {
          // `</script` inside the bundle would end the inline script early.
          const code = item.code.replace(/<\/script/gi, "<\\/script");
          html = html.replace(
            new RegExp(`<script[^>]*src="[^"]*${fileName}"[^>]*></script>`),
            () => `<script type="module">${code}</script>`,
          );
        } else if (item.type === "asset" && fileName.endsWith(".css")) {
          html = html.replace(
            new RegExp(`<link[^>]*href="[^"]*${fileName}"[^>]*>`),
            () => `<style>${String(item.source)}</style>`,
          );
        } else {
          continue;
        }
        rmSync(join(outDir, fileName));
      }
      writeFileSync(join(outDir, htmlName), html);
      rmSync(join(outDir, "assets"), { recursive: true, force: true });
    },
  };
}

/**
 * The shared icon module resolves the app icon with
 * `new URL(..., import.meta.url)` at import time. Inside an MCP App srcdoc
 * iframe `import.meta.url` is `about:srcdoc`, so that throws before React
 * mounts. The node view never renders the app icon: drop the URL here and
 * fail the build if the source pattern changes.
 */
function dropAppIconUrl(): Plugin {
  const pattern = /new URL\((['"])[^'"]*public\/icon\.png\1,\s*import\.meta\.url\)\.href/;
  return {
    name: "pulse-node-view-drop-app-icon",
    enforce: "pre",
    transform(code, id) {
      if (!id.endsWith("/components/icons/brand.tsx")) return null;
      if (!pattern.test(code)) {
        this.error("brand.tsx no longer resolves the app icon via new URL(); update node-view.vite.config.ts");
      }
      return code.replace(pattern, '""');
    },
  };
}

export default defineConfig({
  root: "src/renderer",
  base: "./",
  publicDir: false,
  define: {
    __PULSE_CANVAS_AGENT_OBSERVABILITY__: "false",
  },
  plugins: [dropAppIconUrl(), react(), inlineSingleFile()],
  build: {
    outDir: "../../dist/node-view",
    emptyOutDir: true,
    target: "es2022",
    cssCodeSplit: false,
    // One inlined file by design; size is tracked in harness knowledge, not here.
    chunkSizeWarningLimit: 4096,
    // Fonts and images become data URIs; the sandbox cannot fetch files.
    assetsInlineLimit: Number.MAX_SAFE_INTEGER,
    rollupOptions: {
      input: "src/renderer/node-view.html",
      output: { inlineDynamicImports: true },
    },
  },
});
