#!/usr/bin/env node
// Read-only check: which Canvas nodes exist both inline in a v1 canvas.json and
// as nodes/<id>.json with different content, and which copy the SQLite
// migration will keep. The rule mirrors
// src/main/canvas/persistence/legacy-node-arbitration.ts (a parity test in
// legacy-conflicts.test.ts keeps them aligned), which follows the v1→v2 migration:
//   - the node file wins when the inline copy has no content, or when the node
//     file's updatedAt is strictly newer;
//   - otherwise (canvas.json newer, equal, or timestamps missing) canvas.json wins.
// Nothing is written. Usage:
//   node apps/canvas-workspace/harness/tools/check-legacy-canvas-conflicts.mjs [dataRoot] [--json]
// dataRoot defaults to ~/.pulse-coder/canvas.

import { readdir, readFile, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';

const args = process.argv.slice(2);
const asJson = args.includes('--json');
const root = args.find(arg => !arg.startsWith('--')) ?? join(homedir(), '.pulse-coder', 'canvas');
const FIELDS = ['type', 'title', 'data', 'properties', 'links'];

const hasContent = value => !!value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length > 0;
const time = value => (typeof value === 'number' && Number.isFinite(value) ? value : null);
const iso = value => (value === null ? '-' : new Date(value).toISOString().replace('.000Z', 'Z'));
const size = value => (value === undefined ? 0 : JSON.stringify(value).length);

async function readJson(path) {
  try { return JSON.parse(await readFile(path, 'utf8')); }
  catch (error) { return error.code === 'ENOENT' ? undefined : { __error: error.message }; }
}

function decide(node, atom) {
  const differing = FIELDS.filter(field => node[field] !== undefined && atom[field] !== undefined
    && !isDeepStrictEqual(node[field], atom[field]));
  if (!differing.length) return null;
  const canvasTime = time(node.updatedAt);
  const fileTime = time(atom.updatedAt);
  let reason;
  if (!hasContent(node.data) && (hasContent(atom.data) || (Array.isArray(atom.links) && atom.links.length > 0))) {
    reason = 'empty-inline-data';
  } else if ((canvasTime ?? Number.POSITIVE_INFINITY) < (fileTime ?? 0)) {
    reason = 'node-file-newer';
  } else {
    reason = canvasTime !== null && fileTime !== null && canvasTime > fileTime ? 'canvas-newer' : 'canvas-default';
  }
  const kept = reason === 'empty-inline-data' || reason === 'node-file-newer' ? 'node-file' : 'canvas.json';
  return { differing, kept, reason, canvasTime, fileTime };
}

const rows = [];
const notes = [];
const entries = await readdir(root, { withFileTypes: true }).catch(error => {
  console.error(`Cannot read ${root}: ${error.message}`);
  process.exit(1);
});
for (const entry of entries) {
  if (!entry.isDirectory() || entry.name.startsWith('.') || entry.name.startsWith('__')) continue;
  const dir = join(root, entry.name);
  const canvas = await readJson(join(dir, 'canvas.json'));
  if (canvas === undefined) continue;
  if (canvas.__error) { notes.push(`${entry.name}: canvas.json is not valid JSON (${canvas.__error})`); continue; }
  if (canvas.schemaVersion === 2) continue;
  if (await readJson(join(dir, '.migrating')) !== undefined) {
    notes.push(`${entry.name}: has an interrupted-migration marker (.migrating); handled by backup recovery, not this rule`);
    continue;
  }
  for (const node of Array.isArray(canvas.nodes) ? canvas.nodes : []) {
    if (!node || typeof node.id !== 'string' || (node.type === 'reference' && node.ref)) continue;
    const filePath = join(dir, 'nodes', `${node.id}.json`);
    const atom = await readJson(filePath);
    if (atom === undefined) continue;
    if (atom.__error) { notes.push(`${entry.name}/${node.id}: node file is not valid JSON (${atom.__error})`); continue; }
    const result = decide(node, atom);
    if (!result) continue;
    const mtime = (await stat(filePath)).mtimeMs;
    rows.push({
      workspace: entry.name, node: node.id, kept: result.kept, reason: result.reason,
      canvasUpdatedAt: iso(result.canvasTime), nodeFileUpdatedAt: iso(result.fileTime), nodeFileModified: iso(mtime),
      canvasDataChars: size(node.data), nodeFileDataChars: size(atom.data), differing: result.differing.join(','),
      ...(asJson ? { canvas: Object.fromEntries(result.differing.map(f => [f, node[f]])),
        nodeFile: Object.fromEntries(result.differing.map(f => [f, atom[f]])) } : {}),
    });
  }
}

if (asJson) {
  console.log(JSON.stringify({ root, conflicts: rows, notes }, null, 2));
} else {
  console.log(`Data root: ${root}`);
  if (rows.length) console.table(rows);
  const byWorkspace = rows.reduce((map, row) => map.set(row.workspace, (map.get(row.workspace) ?? 0) + 1), new Map());
  console.log(`\n${rows.length} divergent node(s) in ${byWorkspace.size} workspace(s).`);
  for (const [workspace, count] of byWorkspace) {
    const fromFile = rows.filter(row => row.workspace === workspace && row.kept === 'node-file').length;
    console.log(`  ${workspace}: ${count} node(s); keeps node file for ${fromFile}, canvas.json for ${count - fromFile}`);
  }
  for (const note of notes) console.log(`note: ${note}`);
  console.log('\nRead-only: no file was changed. Add --json for both full copies of every differing field.');
}
