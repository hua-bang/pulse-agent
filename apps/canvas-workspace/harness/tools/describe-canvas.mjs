#!/usr/bin/env node
// Canvas structure snapshot — ground truth extracted from SOURCE, so an agent
// about to add an agent tool, IPC channel, or node type reads the current
// registry instead of prose that drifts. Engine's describe-engine imports the
// built dist; that is impossible here (main-process modules require Electron),
// so this tool does static extraction instead — same purpose, different
// mechanism. Orientation aid first, but it exits non-zero on the two diffs
// that are hard errors (see below).
//
//   node apps/canvas-workspace/harness/tools/describe-canvas.mjs [--json]
//
// Sections:
//   1. Agent tool registry     name: '<snake_case>' entries in src/main/agent/tools/*.ts
//   2. IPC contract diff       ipcMain.handle(...) channels (main + main-side plugins)
//                              vs ipcRenderer.invoke(...) channels (preload)
//                              → invoked-but-never-handled = HARD ERROR (broken call)
//                              → handled-but-never-invoked = informational (webview/
//                                internal/renderer-direct consumers are legitimate)
//   3. Node type registry      CanvasNode.type union (shared/canvas.ts)
//                              vs createNodeData cases (nodeFactory.ts)
//                              → any asymmetry = HARD ERROR (factory must be total)

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

function walk(dir, filter) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full, filter));
    else if (filter(entry.name)) out.push(full);
  }
  return out;
}

const rel = (p) => path.relative(appRoot, p);
const read = (p) => fs.readFileSync(p, 'utf8');
const isSourceTs = (name) => /\.(ts|tsx)$/.test(name) && !/\.test\.|\.d\.ts$/.test(name);

// --- 1. agent tool registry ---
const toolFiles = walk(path.join(appRoot, 'src/main/agent/tools'), isSourceTs);
const tools = [];
for (const file of toolFiles) {
  for (const m of read(file).matchAll(/name:\s*'([a-z][a-z0-9_]+)'/g)) {
    tools.push({ name: m[1], file: rel(file) });
  }
}
tools.sort((a, b) => a.name.localeCompare(b.name));
const dupTools = tools.filter((t, i) => i > 0 && tools[i - 1].name === t.name).map((t) => t.name);

// --- 2. IPC contract: handle vs invoke ---
// Multiline-tolerant: the channel literal may sit on the line after `handle(`.
const channelCall = (source, fn) => {
  const found = [];
  const dynamic = [];
  const regex = new RegExp(String.raw`${fn}\(\s*(["'\`])((?:(?!\1).)*)\1`, 'gs');
  let stripped = 0;
  for (const m of source.matchAll(new RegExp(String.raw`${fn}\(`, 'g'))) stripped += 1;
  for (const m of source.matchAll(regex)) {
    if (m[2].includes('${')) dynamic.push(m[2]);
    else found.push(m[2]);
  }
  return { found, dynamicCount: stripped - found.length };
};

const mainFiles = [
  ...walk(path.join(appRoot, 'src/main'), isSourceTs),
  ...walk(path.join(appRoot, 'src/plugins/main'), isSourceTs),
];
const preloadFiles = walk(path.join(appRoot, 'src/preload'), isSourceTs);

const handled = new Map(); // channel -> file
let handledDynamic = 0;
for (const file of mainFiles) {
  const { found, dynamicCount } = channelCall(read(file), 'ipcMain\\.handle');
  handledDynamic += dynamicCount;
  for (const ch of found) handled.set(ch, rel(file));
}
const invoked = new Map();
let invokedDynamic = 0;
for (const file of preloadFiles) {
  const { found, dynamicCount } = channelCall(read(file), 'ipcRenderer\\.invoke');
  invokedDynamic += dynamicCount;
  for (const ch of found) invoked.set(ch, rel(file));
}

const invokedNotHandled = [...invoked.keys()].filter((ch) => !handled.has(ch)).sort();
const handledNotInvoked = [...handled.keys()].filter((ch) => !invoked.has(ch)).sort();

// --- 3. node types: union vs factory ---
const canvasTs = read(path.join(appRoot, 'src/shared/canvas.ts'));
const unionBlock = canvasTs.match(/interface CanvasNode\s*\{[^]*?type:\s*([^;]+);/);
const unionTypes = unionBlock ? [...unionBlock[1].matchAll(/'([a-z-]+)'/g)].map((m) => m[1]) : [];
const factoryTs = read(path.join(appRoot, 'src/renderer/src/utils/nodeFactory.ts'));
const factoryBlock = factoryTs.match(/createNodeData[^]*?^\};?$/m) ?? [factoryTs];
const factoryTypes = [...factoryBlock[0].matchAll(/case\s+'([a-z-]+)'/g)].map((m) => m[1]);
const unionNotFactory = unionTypes.filter((t) => !factoryTypes.includes(t));
const factoryNotUnion = factoryTypes.filter((t) => !unionTypes.includes(t));

const snapshot = {
  tools: { count: tools.length, byFile: undefined, entries: tools, duplicates: dupTools },
  ipc: {
    handled: handled.size,
    invoked: invoked.size,
    handledDynamic,
    invokedDynamic,
    invokedNotHandled,
    handledNotInvoked,
  },
  nodeTypes: { union: unionTypes, factory: factoryTypes, unionNotFactory, factoryNotUnion },
};

const hardErrors = invokedNotHandled.length + unionNotFactory.length + factoryNotUnion.length + dupTools.length;

if (process.argv.includes('--json')) {
  console.log(JSON.stringify(snapshot, null, 2));
  process.exit(hardErrors ? 1 : 0);
}

console.log('# Canvas structure snapshot\n');

console.log(`## Agent tools (${tools.length} registered in src/main/agent/tools/)`);
let lastFile = '';
for (const t of tools.slice().sort((a, b) => a.file.localeCompare(b.file) || a.name.localeCompare(b.name))) {
  if (t.file !== lastFile) { console.log(`  ${t.file}`); lastFile = t.file; }
  console.log(`    ${t.name}`);
}
if (dupTools.length) console.log(`  !! duplicate tool names: ${dupTools.join(', ')}`);

console.log(`\n## IPC contract (${handled.size} handled · ${invoked.size} invoked from preload)`);
if (invokedNotHandled.length) {
  console.log('  !! invoked from preload but NO ipcMain.handle (broken call):');
  for (const ch of invokedNotHandled) console.log(`     ${ch}  (${invoked.get(ch)})`);
} else {
  console.log('  every preload invoke has a main handler.');
}
console.log(`  handled but not invoked from preload (${handledNotInvoked.length} — often legitimate: webview/internal consumers):`);
for (const ch of handledNotInvoked) console.log(`     ${ch}  (${handled.get(ch)})`);
if (handledDynamic || invokedDynamic) {
  console.log(`  (dynamic channel names skipped: ${handledDynamic} handle, ${invokedDynamic} invoke)`);
}

console.log(`\n## Node types (union ${unionTypes.length} · factory ${factoryTypes.length})`);
console.log(`  ${unionTypes.join(', ')}`);
if (unionNotFactory.length) console.log(`  !! in union but createNodeData has no case: ${unionNotFactory.join(', ')}`);
if (factoryNotUnion.length) console.log(`  !! factory case not in union: ${factoryNotUnion.join(', ')}`);
if (!unionNotFactory.length && !factoryNotUnion.length) console.log('  union and factory are in sync.');

process.exit(hardErrors ? 1 : 0);
