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
//   4. CLI parity              app's CanvasNode.type union vs canvas-cli's NodeType
//                              union (packages/canvas-cli/src/core/types.ts), and
//                              both sides' schema-version constants
//                              (packages/canvas-cli/src/core/storage-v2.ts vs
//                              src/main/canvas/{storage.ts,nodes/store.ts})
//                              → CLI type unknown to the app, or a schema-version
//                                mismatch = HARD ERROR (real bug: the app couldn't
//                                even read what the CLI wrote, or the two are
//                                speaking different on-disk schema versions)
//                              → app type unknown to the CLI is expected (the app
//                                OWNS the schema per its AGENTS.md; the CLI adapts
//                                to it and treats unmodeled types as opaque
//                                passthrough) UNLESS it falls outside the
//                                KNOWN_MISMATCH allowlist below, which gates
//                                currently-accepted drift so this tool stays green
//                                while still recording it (same pattern as this
//                                repo's ui-reuse-governance test's baseline allowlist)
//
// Section 4 reads packages/canvas-cli/src/core/*.ts on purpose: it is a
// read-only ground-truth diff against the CLI's mirrored copies, never an
// edit. Per apps/canvas-workspace/AGENTS.md: "The app owns v2 canvas storage
// migration... The CLI adapts to those contracts but does not own them."

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

// --- 4. CLI parity: node-type union + schema-version constants ---
// Cross-package on purpose (read-only ground truth check against
// canvas-cli's mirrored copies — never edited here); see header comment.
const repoRoot = path.resolve(appRoot, '..', '..');
const cliTypesPath = path.join(repoRoot, 'packages/canvas-cli/src/core/types.ts');
const cliStorageV2Path = path.join(repoRoot, 'packages/canvas-cli/src/core/storage-v2.ts');
const nodesStorePath = path.join(appRoot, 'src/main/canvas/nodes/store.ts');
const storageTsPath = path.join(appRoot, 'src/main/canvas/storage.ts');

const cliTypesTs = fs.existsSync(cliTypesPath) ? read(cliTypesPath) : '';
const cliStorageV2Ts = fs.existsSync(cliStorageV2Path) ? read(cliStorageV2Path) : '';
const nodesStoreTs = fs.existsSync(nodesStorePath) ? read(nodesStorePath) : '';
const storageTs = fs.existsSync(storageTsPath) ? read(storageTsPath) : '';

// Same union-extraction style as section 3, adapted to canvas-cli's node-type
// aliases. The CLI splits its literals across `CreatableNodeType` (types it can
// create) and `KnownNodeType` (all types it reads/models), with the public
// `NodeType = KnownNodeType | (string & {})` adding the opaque passthrough arm
// for unmodeled future types. The modeled literal set is the union of the two
// alias bodies; the `(string & {})` arm intentionally contributes no literal
// (it IS the "treat unknown types as opaque" behavior this section allows for).
const litsOf = (block) => (block ? [...block[1].matchAll(/'([a-z-]+)'/g)].map((m) => m[1]) : []);
const cliCreatableBlock = cliTypesTs.match(/export type CreatableNodeType\s*=\s*([^;]+);/);
const cliKnownBlock = cliTypesTs.match(/export type KnownNodeType\s*=\s*([^;]+);/);
// Fallback to a legacy flat `NodeType` alias so this tool still works if the
// CLI ever collapses the split back into one union.
const cliLegacyBlock = cliTypesTs.match(/export type NodeType\s*=\s*([^;]+);/);
const cliNodeTypes = [
  ...new Set([...litsOf(cliCreatableBlock), ...litsOf(cliKnownBlock), ...litsOf(cliLegacyBlock)]),
];
const appOnlyNodeTypes = unionTypes.filter((t) => !cliNodeTypes.includes(t));
const cliOnlyNodeTypes = cliNodeTypes.filter((t) => !unionTypes.includes(t));

function extractConst(source, name) {
  const m = source.match(new RegExp(String.raw`export const ${name}\s*=\s*(\d+)`));
  return m ? Number(m[1]) : undefined;
}

// App's PER_NODE_SCHEMA_VERSION is an alias (`= WORKSPACE_NODE_SCHEMA_VERSION`)
// defined in nodes/store.ts, not a literal in storage.ts — read the real source.
const appPerNodeSchemaVersion = extractConst(nodesStoreTs, 'WORKSPACE_NODE_SCHEMA_VERSION');
const appCanvasSchemaVersionV2 = extractConst(storageTs, 'CANVAS_SCHEMA_VERSION_V2');
const cliPerNodeSchemaVersion = extractConst(cliStorageV2Ts, 'PER_NODE_SCHEMA_VERSION');
const cliCanvasSchemaVersionV2 = extractConst(cliStorageV2Ts, 'CANVAS_SCHEMA_VERSION_V2');

const schemaVersionMismatches = [];
if (appPerNodeSchemaVersion === undefined || cliPerNodeSchemaVersion === undefined) {
  schemaVersionMismatches.push(
    `PER_NODE_SCHEMA_VERSION extraction failed: app=${appPerNodeSchemaVersion} (nodes/store.ts) cli=${cliPerNodeSchemaVersion} (storage-v2.ts)`,
  );
} else if (appPerNodeSchemaVersion !== cliPerNodeSchemaVersion) {
  schemaVersionMismatches.push(
    `PER_NODE_SCHEMA_VERSION: app=${appPerNodeSchemaVersion} (nodes/store.ts) != cli=${cliPerNodeSchemaVersion} (storage-v2.ts)`,
  );
}
if (appCanvasSchemaVersionV2 === undefined || cliCanvasSchemaVersionV2 === undefined) {
  schemaVersionMismatches.push(
    `CANVAS_SCHEMA_VERSION_V2 extraction failed: app=${appCanvasSchemaVersionV2} (storage.ts) cli=${cliCanvasSchemaVersionV2} (storage-v2.ts)`,
  );
} else if (appCanvasSchemaVersionV2 !== cliCanvasSchemaVersionV2) {
  schemaVersionMismatches.push(
    `CANVAS_SCHEMA_VERSION_V2: app=${appCanvasSchemaVersionV2} (storage.ts) != cli=${cliCanvasSchemaVersionV2} (storage-v2.ts)`,
  );
}

// KNOWN_MISMATCH allowlist — recorded, accepted drift only (mirrors
// ui-reuse-governance.test.ts's KNOWN_UNDEFINED_TOKENS baseline pattern: an
// explicit, commented allowlist rather than a silent skip). Node types the
// APP has that the CLI does not are expected: the app owns the schema
// (AGENTS.md), new node capabilities default to plugin nodes, and the CLI
// treats any node it doesn't specifically model as opaque passthrough data
// (`CanvasNodeData`'s `[key: string]: unknown` in canvas-cli's types.ts). A
// type present in the CLI but ABSENT from the app union is NOT allowlisted
// here — that would mean the app can't even read what the CLI wrote, which
// is a real bug, not drift to accept.
// Empty: the CLI now models every app node type it can read (text, iframe,
// image, shape, dynamic-app, plugin, reference) in its KnownNodeType union, so
// there is currently no accepted app-only drift. New app-only types added
// before the CLI mirrors them go here (recorded, not silently skipped).
const KNOWN_MISMATCH_APP_ONLY_NODE_TYPES = new Set([]);

const unexpectedAppOnlyNodeTypes = appOnlyNodeTypes.filter((t) => !KNOWN_MISMATCH_APP_ONLY_NODE_TYPES.has(t));
const staleAppOnlyAllowlist = [...KNOWN_MISMATCH_APP_ONLY_NODE_TYPES].filter((t) => !appOnlyNodeTypes.includes(t));

const cliParityHardErrors = cliOnlyNodeTypes.length + unexpectedAppOnlyNodeTypes.length + schemaVersionMismatches.length;

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
  cliParity: {
    nodeTypes: {
      app: unionTypes,
      cli: cliNodeTypes,
      appOnly: appOnlyNodeTypes,
      cliOnly: cliOnlyNodeTypes,
      knownMismatchAppOnly: [...KNOWN_MISMATCH_APP_ONLY_NODE_TYPES],
      unexpectedAppOnly: unexpectedAppOnlyNodeTypes,
      staleAllowlistEntries: staleAppOnlyAllowlist,
    },
    schemaVersions: {
      app: { PER_NODE_SCHEMA_VERSION: appPerNodeSchemaVersion, CANVAS_SCHEMA_VERSION_V2: appCanvasSchemaVersionV2 },
      cli: { PER_NODE_SCHEMA_VERSION: cliPerNodeSchemaVersion, CANVAS_SCHEMA_VERSION_V2: cliCanvasSchemaVersionV2 },
      mismatches: schemaVersionMismatches,
    },
  },
};

const hardErrors =
  invokedNotHandled.length + unionNotFactory.length + factoryNotUnion.length + dupTools.length + cliParityHardErrors;

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

console.log(`\n## CLI parity (app <-> packages/canvas-cli, read-only ground-truth diff)`);
console.log(`  node types — app ${unionTypes.length} · cli ${cliNodeTypes.length}: ${cliNodeTypes.join(', ')}`);
if (cliOnlyNodeTypes.length) {
  console.log(`  !! type(s) in canvas-cli's NodeType but NOT in the app's union (app can't read what the CLI writes): ${cliOnlyNodeTypes.join(', ')}`);
}
if (unexpectedAppOnlyNodeTypes.length) {
  console.log(`  !! app-only type(s) NOT covered by KNOWN_MISMATCH_APP_ONLY_NODE_TYPES: ${unexpectedAppOnlyNodeTypes.join(', ')}`);
} else if (appOnlyNodeTypes.length) {
  console.log(`  app-only types, allowlisted as known/expected drift (CLI adapts, does not own the schema): ${appOnlyNodeTypes.join(', ')}`);
} else {
  console.log('  node-type unions are in sync (no app-only types).');
}
if (staleAppOnlyAllowlist.length) {
  console.log(`  (info) KNOWN_MISMATCH_APP_ONLY_NODE_TYPES has stale entries no longer app-only — safe to remove: ${staleAppOnlyAllowlist.join(', ')}`);
}
console.log(
  `  schema versions — app: PER_NODE_SCHEMA_VERSION=${appPerNodeSchemaVersion}, CANVAS_SCHEMA_VERSION_V2=${appCanvasSchemaVersionV2}` +
    ` · cli: PER_NODE_SCHEMA_VERSION=${cliPerNodeSchemaVersion}, CANVAS_SCHEMA_VERSION_V2=${cliCanvasSchemaVersionV2}`,
);
if (schemaVersionMismatches.length) {
  console.log('  !! schema-version mismatch:');
  for (const m of schemaVersionMismatches) console.log(`     ${m}`);
} else {
  console.log('  schema-version constants match.');
}

process.exit(hardErrors ? 1 : 0);
