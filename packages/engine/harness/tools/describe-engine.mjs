#!/usr/bin/env node
// Engine structure snapshot — ground truth from the built package, so an agent
// about to add/modify a built-in plugin or tool reads the CURRENT reality
// instead of prose that drifts (this session hand-fixed three such drifts:
// the two-barrel export asymmetry, the plugin dependency edges, and the
// defer_loading tool list). Orientation aid, not a pass/fail check.
//
//   node packages/engine/harness/tools/describe-engine.mjs [--json]
//
// Requires a build first (reads dist): pnpm --filter pulse-coder-engine build
// Section 3 runs each plugin's initialize() with a recording mock context to
// enumerate plugin-registered tools; that touches disk/network (MCP/skills
// scan config), which fails closed and is reported as "(none captured)".

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const engineRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const distMain = path.join(engineRoot, 'dist', 'index.js');
const distBuiltIn = path.join(engineRoot, 'dist', 'built-in', 'index.js');

if (!fs.existsSync(distMain) || !fs.existsSync(distBuiltIn)) {
  console.error('dist not found — build first: pnpm --filter pulse-coder-engine build');
  process.exit(1);
}

// dist import (dotenv) and plugin init (MCP/skills scans) write to stdout/stderr;
// silence both so --json stays machine-parseable and the report stays clean.
const realOut = process.stdout.write.bind(process.stdout);
const realErr = process.stderr.write.bind(process.stderr);
const silence = () => { process.stdout.write = () => true; process.stderr.write = () => true; };
const unsilence = () => { process.stdout.write = realOut; process.stderr.write = realErr; };

silence();
const main = await import(distMain);
const builtIn = await import(distBuiltIn);

// --- 1. plugin order + dependency edges ---
const plugins = builtIn.builtInPlugins.map((p) => ({
  name: p.name,
  dependencies: p.dependencies ?? [],
}));
const pluginNames = new Set(plugins.map((p) => p.name));
const danglingDeps = plugins.flatMap((p) =>
  p.dependencies.filter((d) => !pluginNames.has(d)).map((d) => `${p.name} -> ${d}`),
);

// --- 2. two-barrel export asymmetry ---
const mainKeys = new Set(Object.keys(main));
const builtInOnly = Object.keys(builtIn)
  .filter((k) => k !== 'default' && !mainKeys.has(k))
  .sort();

// --- 3. all tools + defer_loading, by source ---
const isDeferred = (t) => Boolean(t?.defer_loading || t?.deferLoading);
const tools = [];
for (const t of main.BuiltinTools ?? []) {
  tools.push({ name: t.name, deferred: isDeferred(t), source: 'BuiltinTools' });
}
for (const plugin of builtIn.builtInPlugins) {
  const captured = [];
  const record = (tool, fallback) => captured.push({ name: tool?.name ?? fallback, deferred: isDeferred(tool) });
  const ctx = {
    registerTool: (name, tool) => record(tool, name),
    registerTools: (map) => { for (const k of Object.keys(map)) record(map[k], k); },
    registerService: () => {}, getService: () => undefined,
    getTool: () => undefined, getTools: () => ({}),
    registerHook: () => {}, getConfig: () => undefined, setConfig: () => {},
    getEngineInstance: () => ({}), events: { on() {}, emit() {}, off() {} },
    logger: { debug() {}, info() {}, warn() {}, error() {} },
  };
  try {
    await Promise.race([
      Promise.resolve(plugin.initialize?.(ctx)),
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 2000)),
    ]);
  } catch {
    // side-effecting init (MCP network, skills disk) may fail closed; keep whatever registered first
  }
  for (const t of captured) tools.push({ ...t, source: plugin.name });
}

unsilence();

const snapshot = { plugins, danglingDeps, mainBarrelOmits: builtInOnly, tools };

if (process.argv.includes('--json')) {
  console.log(JSON.stringify(snapshot, null, 2));
  process.exit(danglingDeps.length ? 1 : 0);
}

console.log('# Engine structure snapshot\n');

console.log('## Built-in plugins (registration order = hook/tool-pipeline order)');
plugins.forEach((p, i) => {
  const deps = p.dependencies.length ? `  deps=[${p.dependencies.join(', ')}]` : '';
  console.log(`  ${i + 1}. ${p.name}${deps}`);
});
if (danglingDeps.length) {
  console.log('  !! dangling dependency (aborts Engine construction): ' + danglingDeps.join('; '));
}

console.log('\n## Two-barrel exports');
console.log('  ./built-in exports but `.` (main) omits: ' + (builtInOnly.length ? builtInOnly.join(', ') : '(in sync)'));
console.log('  → a public-surface change must update both barrels deliberately (see contracts.md).');

console.log('\n## Tools (name · deferred? · registered by)');
for (const t of tools) {
  console.log(`  ${t.name}${t.deferred ? ' [defer]' : ''}  ·  ${t.source}`);
}
console.log(`\n  ${tools.filter((t) => t.deferred).length}/${tools.length} are defer_loading (hidden until tool-search loads them).`);
