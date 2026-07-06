#!/usr/bin/env node
/**
 * Terminal bundle view: entry vs async split + per-chunk drill-down.
 *
 * The HTML treemap (perf/out/bundle-treemap.html, from `pnpm perf:analyze`)
 * flattens all chunks with no entry/async distinction and no chunk-to-chunk
 * edges — so it can't tell startup cost from lazy cost. This script reads the
 * JSON embedded in that HTML plus the entry chunk referenced by
 * dist/renderer/index.html, and prints a consumable terminal breakdown:
 *
 *   pnpm perf:treemap                # entry/async split + async grouped by feature
 *   pnpm perf:treemap wardley        # drill one chunk's internal modules
 *   pnpm perf:treemap index-MzodTW7F # drill the entry's internals
 *
 * Requires `pnpm perf:analyze` to have run first (generates the HTML).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { renderBundleSplitHtml } from "./bundle-split-html.mjs";

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const treemapPath = join(appRoot, "perf/out/bundle-treemap.html");
const manifestPath = join(appRoot, "dist/renderer/manifest.json");
const indexHtmlPath = join(appRoot, "dist/renderer/index.html");
const splitHtmlPath = join(appRoot, "perf/out/bundle-split.html");

const kb = (bytes) => Math.round(bytes / 1024);

const extractData = (html) => {
  const m = html.match(/const data = (\{[\s\S]*?\});\n/);
  if (!m) throw new Error("could not find embedded data in bundle-treemap.html");
  return JSON.parse(m[1]);
};

// chunk node only has {name, children}; size lives in nodeParts[uid].renderedLength.
// Returns bytes — always wrap with kb() at the call site.
const sizeOf = (node, parts) => {
  if (node.uid && parts[node.uid]) return parts[node.uid].renderedLength;
  if (!node.children) return 0;
  return node.children.reduce((s, c) => s + sizeOf(c, parts), 0);
};

const chunkKb = (node, parts) => kb(sizeOf(node, parts));

const flattenLeaves = (node, parts, path = "") => {
  const cur = path ? `${path}/${node.name}` : node.name;
  if (!node.children || node.children.length === 0) {
    return [{ path: cur || node.name, kb: kb(parts[node.uid]?.renderedLength ?? 0) }];
  }
  return node.children.flatMap((c) => flattenLeaves(c, parts, cur));
};

// entry from Vite's official manifest (isEntry: true) — the standardized
// source. Falls back to index.html's <script> heuristic when manifest absent.
const findEntryFromManifest = (manifest) => {
  for (const info of Object.values(manifest)) {
    if (info.isEntry && info.file) return info.file.split("/").pop();
  }
  return null;
};

const findEntryFromHtml = (indexHtml) => {
  const m = indexHtml.match(/<script[^>]*type="module"[^>]*src="\.?\/?([^"]+)"/);
  return m ? m[1].split("/").pop() : null;
};

// async chunk feature buckets — matches the chunk filename, not internal modules
const categorize = (name) => {
  if (/^(mermaid|wardley|architectureDiagram|sequenceDiagram|blockDiagram|ganttDiagram|c4Diagram|flowDiagram|vennDiagram|xychartDiagram|quadrantDiagram|timeline-definition|gitGraphDiagram|requirementDiagram|erDiagram|sankeyDiagram|journeyDiagram|wardleyDiagram|mindmap-definition|kanban-definition|ishikawaDiagram|classDiagram|stateDiagram|infoDiagram|pieDiagram|diagram-)/.test(name)) return "Mermaid 图表";
  if (/^(cytoscape|cose-bilkent|dagre)/.test(name)) return "Cytoscape + 图布局";
  if (/^katex/.test(name)) return "KaTeX(数学公式)";
  if (/^xterm/.test(name)) return "xterm(终端)";
  if (/^tiptap/.test(name)) return "Tiptap(富文本)";
  if (/^(useChatComposerState|ChatPage|ChatPanel)/.test(name)) return "Chat 特性";
  if (/^GraphPage/.test(name)) return "Graph 视图页";
  return "应用代码 / 共享 chunks";
};

const row = (kbVal, label, indent = 0) =>
  `  ${kbVal.toString().padStart(6)} KB  ${" ".repeat(indent)}${label}`;

const pct = (part, whole) => ((part / whole) * 100).toFixed(0);

const printOverview = (chunks, parts, entryName) => {
  const entry = chunks.find((c) => c.name.includes(entryName));
  const entryKb = entry ? chunkKb(entry, parts) : 0;
  const asyncChunks = chunks.filter((c) => !c.name.includes(entryName));
  const asyncKb = asyncChunks.reduce((s, c) => s + chunkKb(c, parts), 0);
  const totalKb = entryKb + asyncKb;

  console.log("Entry vs Async(来源:perf/out/bundle-treemap.html)");
  console.log("─".repeat(74));
  console.log(`✱ ENTRY  启动时全量 parse — 每次启动都付成本`);
  console.log(row(entryKb, `${entryName}  (${pct(entryKb, totalKb)}%)`));
  if (entry) {
    const leaves = flattenLeaves(entry, parts).filter((l) => l.kb > 0).sort((a, b) => b.kb - a.kb);
    const top = leaves.slice(0, 5);
    if (top.length) {
      console.log("          内部 top 模块(启动成本构成):");
      for (const l of top) {
        const short = l.path.split("/").slice(-2).join("/").replace(/^assets\/[^/]+\//, "");
        console.log(row(l.kb, `${short}  (${pct(l.kb, entryKb)}%)`, 10));
      }
    }
  }
  console.log();
  console.log(`ASYNC   按需 lazy — 用到对应功能才加载`);
  console.log(row(asyncKb, `合计 ${asyncChunks.length} chunks  (${pct(asyncKb, totalKb)}%)`));
  console.log();
  console.log("  按 feature 分组:");
  const groups = new Map();
  for (const c of asyncChunks) {
    const name = c.name.replace(/^assets\//, "");
    const cat = categorize(name);
    if (!groups.has(cat)) groups.set(cat, { cat, kb: 0, n: 0, items: [] });
    const g = groups.get(cat);
    g.kb += chunkKb(c, parts);
    g.n += 1;
    g.items.push({ name, kb: chunkKb(c, parts) });
  }
  const sortedGroups = [...groups.values()].sort((a, b) => b.kb - a.kb);
  for (const g of sortedGroups) {
    console.log(row(g.kb, `${g.cat}  (${g.n} chunks)`, 4));
    const top = g.items.sort((a, b) => b.kb - a.kb).slice(0, 3);
    const tail = top.map((i) => `${i.name.replace(/-[A-Za-z0-9_-]{8,}/, "")} ${i.kb}KB`).join(" · ");
    console.log(`            ${tail}`);
  }
  console.log("─".repeat(74));
  console.log(row(totalKb, `合计  (entry ${pct(entryKb, totalKb)}% / async ${pct(asyncKb, totalKb)}%)`));
};

const printDrill = (chunks, parts, entryName, query) => {
  const matches = chunks.filter((c) => c.name.includes(query));
  if (matches.length === 0) {
    console.error(`[perf:treemap] 没有匹配 "${query}" 的 chunk`);
    console.error("可用 chunk 见 perf/out/bundle-treemap.html");
    process.exit(1);
  }
  for (const chunk of matches) {
    const isEntry = chunk.name.includes(entryName);
    const totalKb = chunkKb(chunk, parts);
    const leaves = flattenLeaves(chunk, parts).filter((l) => l.kb > 0).sort((a, b) => b.kb - a.kb);
    console.log(`=== ${chunk.name.replace(/^assets\//, "")} · ${totalKb} KB · ${isEntry ? "✱ ENTRY" : "ASYNC"} ===`);
    console.log(`叶子模块 ${leaves.length} 个,top ${Math.min(15, leaves.length)}:`);
    let acc = 0;
    for (const l of leaves.slice(0, 15)) {
      acc += l.kb;
      const short = l.path.split("/").slice(-3).join("/");
      console.log(row(l.kb, `${pct(l.kb, totalKb).padStart(3)}%  ${short}`, 2));
    }
    if (leaves.length > 15) console.log(`  … 另 ${leaves.length - 15} 个小模块`);
    console.log(`  ── 已列 ${acc} / ${totalKb} KB = ${pct(acc, totalKb)}%`);
    console.log();
  }
};

// Build the structured view consumed by the HTML emitter. Flat chunks array
// with isEntry/feature/leaves — the emitter derives Overview/Chunks/Modules/
// Duplicates views client-side from this single source.
const buildView = (chunks, parts, entryName) => {
  const entry = chunks.find((c) => c.name.includes(entryName));
  const entryKb = entry ? chunkKb(entry, parts) : 0;
  const asyncChunks = chunks.filter((c) => !c.name.includes(entryName));
  const asyncKb = asyncChunks.reduce((s, c) => s + chunkKb(c, parts), 0);
  const totalKb = entryKb + asyncKb;
  const allChunks = chunks
    .map((c) => {
      const name = c.name.replace(/^assets\//, "");
      const isEntry = name.includes(entryName);
      const leaves = flattenLeaves(c, parts)
        .filter((l) => l.kb > 0)
        .sort((a, b) => b.kb - a.kb)
        .map((l) => ({ path: l.path, kb: l.kb }));
      return {
        name,
        kb: chunkKb(c, parts),
        isEntry,
        feature: isEntry ? "ENTRY" : categorize(name),
        moduleCount: leaves.length,
        leaves,
      };
    })
    .sort((a, b) => b.kb - a.kb);
  return { totalKb, entryKb, asyncKb, chunks: allChunks };
};

const main = () => {
  if (!existsSync(treemapPath)) {
    console.error(`[perf:treemap] 缺 ${treemapPath}\n先跑:pnpm --filter canvas-workspace perf:analyze`);
    process.exit(2);
  }
  const data = extractData(readFileSync(treemapPath, "utf8"));
  const parts = data.nodeParts;
  const chunks = data.tree.children;
  // 优先从官方 manifest 取入口,缺失时回退到 index.html 推断
  let entryName = null;
  if (existsSync(manifestPath)) {
    entryName = findEntryFromManifest(JSON.parse(readFileSync(manifestPath, "utf8")));
  }
  if (!entryName && existsSync(indexHtmlPath)) {
    entryName = findEntryFromHtml(readFileSync(indexHtmlPath, "utf8"));
  }
  if (!entryName) {
    console.error("[perf:treemap] 无法确定入口 chunk(manifest.json 和 index.html 都没找到/解析失败)");
    process.exit(2);
  }
  const view = buildView(chunks, parts, entryName);
  mkdirSync(join(appRoot, "perf/out"), { recursive: true });
  writeFileSync(splitHtmlPath, renderBundleSplitHtml(view));

  const query = process.argv[2];
  if (query) printDrill(chunks, parts, entryName, query);
  else printOverview(chunks, parts, entryName);
  console.log(`[perf:treemap] HTML: ${splitHtmlPath.replace(appRoot + "/", "")}`);
};

main();
