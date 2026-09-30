/**
 * Manual end-to-end check for the `pulse-canvas mcp` view.
 *
 * Starts the BUILT server (`dist/index.cjs mcp`) against a seeded temporary
 * store, hosts `ui://pulse-canvas/workspace.html` in Chromium through the
 * official MCP Apps host bridge (`AppBridge`), and drives real edits: drag,
 * body/file/label edits, frame carry, create/connect/delete, external agent
 * edits, workspace switching, display mode, links, model context, theming,
 * and the no-active-workspace picker. Every edit is verified on disk.
 *
 *   pnpm --filter @pulse-coder/canvas-cli build
 *   node packages/canvas-cli/harness/tools/mcp-app-e2e/run.mjs
 *
 * Set CHROMIUM_PATH when Playwright's bundled browser is not installed.
 * Screenshots land in .harness/mcp-app-e2e/ (gitignored) for inspection.
 */
import { promises as fs } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const toolDir = fileURLToPath(new URL('.', import.meta.url));
const packageRoot = join(toolDir, '..', '..', '..');
const repoRoot = join(packageRoot, '..', '..');
const cliRequire = createRequire(join(packageRoot, 'package.json'));
// Playwright is a canvas-workspace dev dependency; reuse it instead of adding one here.
const { chromium } = createRequire(join(repoRoot, 'apps', 'canvas-workspace', 'package.json'))('@playwright/test');
const { Client } = cliRequire('@modelcontextprotocol/sdk/client/index.js');
const { StdioClientTransport } = cliRequire('@modelcontextprotocol/sdk/client/stdio.js');
const { build } = cliRequire('tsup');

const workDir = await fs.mkdtemp(join(tmpdir(), 'pulse-canvas-mcp-app-e2e-'));
const storeDir = join(workDir, 'store');
const shots = join(repoRoot, '.harness', 'mcp-app-e2e');
const cli = join(packageRoot, 'dist', 'index.cjs');
const ws = 'ws-demo';
const wsDir = join(storeDir, ws);
const log = (...a) => console.log('[mcp-app-e2e]', ...a);
const assert = (cond, msg) => { if (!cond) throw new Error('ASSERT: ' + msg); log('ok -', msg); };
const readCanvas = async () => JSON.parse(await fs.readFile(join(wsDir, 'canvas.json'), 'utf-8'));
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function waitFor(fn, msg, timeout = 8000) {
  const start = Date.now();
  while (Date.now() - start < timeout) { try { if (await fn()) { log('ok -', msg); return; } } catch {} await sleep(150); }
  throw new Error('TIMEOUT: ' + msg);
}

// Bundle the test host (AppBridge + PostMessageTransport) for the browser.
await build({
  config: false,
  entry: { host: join(toolDir, 'host.ts') },
  outDir: join(workDir, 'host'),
  format: ['iife'],
  platform: 'browser',
  noExternal: [/.*/],
  dts: false,
  silent: true,
  esbuildOptions(options) {
    options.nodePaths = [join(packageRoot, 'node_modules')];
  },
});
const hostScript = await fs.readFile(join(workDir, 'host', 'host.global.js'), 'utf-8');

await fs.rm(shots, { recursive: true, force: true });
await fs.mkdir(join(wsDir, 'notes'), { recursive: true });
await fs.mkdir(shots, { recursive: true });
const notePath = join(wsDir, 'notes', 'plan.md');
await fs.writeFile(notePath, '# Launch plan\n\n- [x] Draft spec\n- [ ] Ship **MCP App**\n\nSee [docs](https://example.com/docs) and `pulse-canvas mcp`.');
await fs.writeFile(join(wsDir, 'canvas.json'), JSON.stringify({
  nodes: [
    { id: 'f1', type: 'frame', title: 'Frame', x: 0, y: 0, width: 780, height: 540, data: { label: 'Q3 launch', color: '#4f6bed' } },
    { id: 'n1', type: 'file', title: 'Plan', x: 40, y: 60, width: 320, height: 240, data: { filePath: notePath, content: '' } },
    { id: 't1', type: 'text', title: 'Idea', x: 420, y: 80, width: 300, height: 180, data: { content: 'Open the canvas **inside Codex**.' } },
    { id: 'term1', type: 'terminal', title: 'Dev server', x: 880, y: 60, width: 360, height: 220, data: { cwd: '/home/user/project' } },
    { id: 'm1', type: 'mindmap', title: 'Topics', x: 880, y: 330, width: 360, height: 220, data: { root: { id: 'r', text: 'Canvas in Codex', children: [{ id: 'a', text: 'MCP server', children: [] }, { id: 'b', text: 'MCP App view', children: [] }] } } },
  ],
  edges: [{ id: 'e1', source: { kind: 'node', nodeId: 'n1' }, target: { kind: 'node', nodeId: 't1' }, label: 'supports' }],
  transform: { x: 0, y: 0, scale: 1 },
  savedAt: new Date().toISOString(),
}));
await fs.writeFile(join(storeDir, '__workspaces__.json'), JSON.stringify({ workspaces: [{ id: ws, name: 'Demo' }, { id: 'ws-other', name: 'Other' }], activeId: ws }));
await fs.mkdir(join(storeDir, 'ws-other'), { recursive: true });
await fs.writeFile(join(storeDir, 'ws-other', 'canvas.json'), JSON.stringify({ nodes: [{ id: 'o1', type: 'text', title: 'Other card', x: 0, y: 0, width: 240, height: 140, data: { content: 'Second workspace' } }], edges: [], transform: { x: 0, y: 0, scale: 1 }, savedAt: new Date().toISOString() }));

const client = new Client({ name: 'e2e', version: '1' });
await client.connect(new StdioClientTransport({ command: process.execPath, args: [cli, '--store-dir', storeDir, 'mcp', '--plugin-api', '1'], env: { ...process.env, HOME: workDir } }));
const opened = await client.callTool({ name: 'canvas_open', arguments: {} });
log('canvas_open:', opened.content[0].text);
const html = (await client.readResource({ uri: 'ui://pulse-canvas/workspace.html' })).contents[0].text;
assert(html.length > 100000, 'resource serves the bundled view');

const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const page = await browser.newPage({ viewport: { width: 1240, height: 940 } });
page.on('console', m => { if (m.type() === 'error') log('console error:', m.text()); });
page.on('pageerror', e => log('page error:', e.message));
await page.exposeFunction('hostCallTool', params => client.callTool(params));
await page.setContent('<html><body style="margin:0;background:#ddd"></body></html>');
await page.addScriptTag({ content: hostScript });
await page.evaluate(({ html, result }) => window.startHost(html, result), { html, result: opened });
const view = page.frameLocator('iframe');

await view.locator('.pc-node').first().waitFor();
await waitFor(async () => (await view.locator('.pc-node').count()) === 5, 'renders all 5 nodes');
assert(await view.locator('.pc-node[data-node-id="n1"] h3').textContent() === 'Launch plan', 'file node renders markdown from its backing file');
assert((await view.locator('.pc-node[data-node-id="term1"]').textContent()).includes('Open in Pulse Canvas'), 'terminal shows live-only card');
assert((await view.locator('.pc-edge-label').textContent()) === 'supports', 'edge label renders');
await sleep(400);
await page.screenshot({ path: join(shots, '1-opened.png') });

// Drag the text node by its header.
const header = view.locator('.pc-node[data-node-id="t1"] .pc-node-header');
const box = await header.boundingBox();
await page.mouse.move(box.x + 60, box.y + 10);
await page.mouse.down();
await page.mouse.move(box.x + 160, box.y + 110, { steps: 8 });
await page.mouse.up();
const before = (await readCanvas()).nodes.find(n => n.id === 't1');
await waitFor(async () => { const n = (await readCanvas()).nodes.find(n => n.id === 't1'); return n.x !== before.x && n.y !== before.y; }, 'drag persists new position');

// Edit the text node body.
await view.locator('.pc-node[data-node-id="t1"] .pc-node-body').dblclick();
await view.locator('textarea.pc-editor').fill('Edited from the **Codex** view');
await view.locator('textarea.pc-editor').press('Control+Enter');
await waitFor(async () => (await readCanvas()).nodes.find(n => n.id === 't1').data.content === 'Edited from the **Codex** view', 'body edit persists');

// Edit the file node: markdown goes to its backing file.
await view.locator('.pc-node[data-node-id="n1"] .pc-node-body').dblclick();
await view.locator('textarea.pc-editor').fill('# Launch plan v2\n\nUpdated.');
await view.locator('textarea.pc-editor').press('Control+Enter');
await waitFor(async () => (await fs.readFile(notePath, 'utf-8')) === '# Launch plan v2\n\nUpdated.', 'file edit writes the backing markdown file');

// Rename the frame label.
await view.locator('.pc-node[data-node-id="f1"] .pc-node-header').dblclick();
await view.locator('input.pc-title-editor').fill('Q4 launch');
await view.locator('input.pc-title-editor').press('Enter');
await waitFor(async () => (await readCanvas()).nodes.find(n => n.id === 'f1').data.label === 'Q4 launch', 'frame label rename persists');

// Drag the frame: it carries the file node inside it.
const n1Before = (await readCanvas()).nodes.find(n => n.id === 'n1');
const frameHeader = await view.locator('.pc-node[data-node-id="f1"] .pc-node-header').boundingBox();
await page.mouse.move(frameHeader.x + 20, frameHeader.y + 6);
await page.mouse.down();
await page.mouse.move(frameHeader.x + 20, frameHeader.y + 66, { steps: 6 });
await page.mouse.up();
await waitFor(async () => (await readCanvas()).nodes.find(n => n.id === 'n1').y > n1Before.y, 'dragging a frame moves its contained node');

// Create a note from the toolbar, type into it.
await view.locator('[data-action="note"]').click();
await view.locator('textarea.pc-editor').fill('New note from Codex');
await view.locator('textarea.pc-editor').press('Control+Enter');
let created;
await waitFor(async () => { created = (await readCanvas()).nodes.find(n => n.type === 'file' && n.id !== 'n1'); return created && created.data.filePath; }, 'toolbar note creates a file node');
await waitFor(async () => (await fs.readFile(created.data.filePath, 'utf-8')) === 'New note from Codex', 'new note body lands in its markdown file');

// Connect the plan to the new note.
await view.locator('[data-action="connect"]').click();
await view.locator('.pc-node[data-node-id="n1"] .pc-node-body').click();
await view.locator(`.pc-node[data-node-id="${created.id}"] .pc-node-body`).click();
await waitFor(async () => (await readCanvas()).edges.length === 2, 'connect mode creates an edge');
await view.locator('[data-action="connect"]').click();

// Model context reflects the selection.
await view.locator('.pc-node[data-node-id="m1"] .pc-node-header').click();
await waitFor(async () => (await page.evaluate(() => window.hostEvents)).some(e => e.type === 'context' && JSON.stringify(e.params).includes('(id: m1)')), 'selection is published as model context');
await page.screenshot({ path: join(shots, '2-edited.png') });

// Delete the new note (edges go with it).
await view.locator(`.pc-node[data-node-id="${created.id}"] .pc-node-header`).click();
await view.locator('[data-action="delete"]').click();
await waitFor(async () => { const c = await readCanvas(); return !c.nodes.some(n => n.id === created.id) && c.edges.length === 1; }, 'delete removes the node and its edges');

// An agent edit elsewhere shows up without reload.
await client.callTool({ name: 'canvas_apply', arguments: { operations: [{ action: 'update', id: 'term1', title: 'Renamed by agent' }] } });
await waitFor(async () => (await view.locator('.pc-node[data-node-id="term1"] .pc-node-title').textContent()) === 'Renamed by agent', 'external change appears via polling', 10000);

// Workspace switch.
await view.locator('.pc-workspace').selectOption('ws-other');
await waitFor(async () => (await view.locator('.pc-node').count()) === 1 && (await view.locator('.pc-node-title').textContent()) === 'Other card', 'workspace picker switches canvases');
await view.locator('.pc-workspace').selectOption(ws);
await waitFor(async () => (await view.locator('.pc-node').count()) === 5, 'switches back');

// Display mode.
await view.locator('[data-action="display-mode"]').click();
await waitFor(async () => (await page.evaluate(() => window.hostEvents)).some(e => e.type === 'display' && e.mode === 'fullscreen'), 'expand requests fullscreen');
await sleep(500);
await page.screenshot({ path: join(shots, '3-fullscreen.png') });

// Link opens through host.
await view.locator('.pc-node[data-node-id="n1"] .pc-node-body').dblclick();
await view.locator('textarea.pc-editor').fill('[docs](https://example.com/docs)');
await view.locator('textarea.pc-editor').press('Control+Enter');
await view.locator('.pc-node[data-node-id="n1"] a[data-href]').click();
await waitFor(async () => (await page.evaluate(() => window.hostEvents)).some(e => e.type === 'link' && e.params.url === 'https://example.com/docs'), 'links open through the host');

await page.evaluate(() => window.bridge.sendHostContextChange({ theme: 'dark' }));
await sleep(400);
await page.screenshot({ path: join(shots, '4-dark.png') });
const calls = (await page.evaluate(() => window.hostEvents)).filter(e => e.type === 'call').map(e => e.name);
log('tool calls from view:', JSON.stringify(calls.reduce((a, n) => ({ ...a, [n]: (a[n] ?? 0) + 1 }), {})));
const errors = (await page.evaluate(() => window.hostEvents)).filter(e => e.type === 'log');
log('view logs:', JSON.stringify(errors));
// Picker: nothing active in the app.
await fs.writeFile(join(storeDir, '__workspaces__.json'), JSON.stringify({ workspaces: [{ id: ws, name: 'Demo' }, { id: 'ws-other', name: 'Other' }] }));
const pickerOpen = await client.callTool({ name: 'canvas_open', arguments: {} });
assert(pickerOpen.structuredContent.workspaceId === null, 'canvas_open {} without an active workspace returns a picker result');
const page2 = await browser.newPage({ viewport: { width: 1240, height: 940 } });
await page2.exposeFunction('hostCallTool', params => client.callTool(params));
await page2.setContent('<html><body style="margin:0"></body></html>');
await page2.addScriptTag({ content: hostScript });
await page2.evaluate(({ html, result }) => window.startHost(html, result), { html, result: pickerOpen });
const view2 = page2.frameLocator('iframe');
await waitFor(async () => (await view2.locator('.pc-status').textContent()) === 'Pick a workspace to open.', 'view shows the picker prompt');
await sleep(1800);
assert((await view2.locator('.pc-node').count()) === 0, 'fallback load does not override the picker');
await view2.locator('.pc-workspace').selectOption('ws-other');
await waitFor(async () => (await view2.locator('.pc-node').count()) === 1, 'picking a workspace opens it');
await browser.close();
await client.close();
await fs.rm(workDir, { recursive: true, force: true });
log(`ALL PASSED — screenshots in ${shots}`);
