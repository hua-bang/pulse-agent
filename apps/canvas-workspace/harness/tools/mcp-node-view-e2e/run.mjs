/**
 * Manual end-to-end check for the MCP node view.
 *
 * Starts the BUILT `pulse-canvas mcp` server against a seeded temporary
 * store, hosts `ui://pulse-canvas/node.html` (this app's node bodies, built
 * by `build:node-view`) in Chromium through the official MCP Apps host
 * bridge (`AppBridge`), and edits real nodes: a mindmap topic tree and a
 * text node. Every edit is verified on disk; agent edits made elsewhere must
 * appear in the open view.
 *
 *   pnpm --filter @pulse-coder/canvas-cli build
 *   pnpm --filter canvas-workspace build:node-view
 *   node apps/canvas-workspace/harness/tools/mcp-node-view-e2e/run.mjs
 *
 * Set CHROMIUM_PATH when Playwright's bundled browser is not installed.
 * Screenshots land in .harness/mcp-node-view-e2e/ (gitignored).
 */
import { promises as fs } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const toolDir = fileURLToPath(new URL('.', import.meta.url));
const appRoot = join(toolDir, '..', '..', '..');
const repoRoot = join(appRoot, '..', '..');
const appRequire = createRequire(join(appRoot, 'package.json'));
const { chromium } = appRequire('@playwright/test');
const { Client } = appRequire('@modelcontextprotocol/sdk/client/index.js');
const { StdioClientTransport } = appRequire('@modelcontextprotocol/sdk/client/stdio.js');
const viteRoot = dirname(appRequire.resolve('vite/package.json'));
const { build } = await import(pathToFileURL(join(viteRoot, 'dist', 'node', 'index.js')).href);

const cli = join(repoRoot, 'packages', 'canvas-cli', 'dist', 'index.cjs');
const nodeViewHtml = join(appRoot, 'dist', 'node-view', 'node-view.html');
const workDir = await fs.mkdtemp(join(tmpdir(), 'pulse-canvas-node-view-e2e-'));
const storeDir = join(workDir, 'store');
const shots = join(repoRoot, '.harness', 'mcp-node-view-e2e');
const ws = 'ws-demo';
const wsDir = join(storeDir, ws);

const log = (...args) => console.log('[mcp-node-view-e2e]', ...args);
const assert = (condition, message) => {
  if (!condition) throw new Error(`ASSERT: ${message}`);
  log('ok -', message);
};
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const readCanvas = async () => JSON.parse(await fs.readFile(join(wsDir, 'canvas.json'), 'utf-8'));
const nodeOnDisk = async id => (await readCanvas()).nodes.find(node => node.id === id);
async function waitFor(check, message, timeout = 8000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    try {
      if (await check()) {
        log('ok -', message);
        return;
      }
    } catch {
      // Not ready yet.
    }
    await sleep(150);
  }
  throw new Error(`TIMEOUT: ${message}`);
}

for (const required of [cli, nodeViewHtml]) {
  await fs.access(required).catch(() => {
    throw new Error(`Missing ${required}; build canvas-cli and build:node-view first.`);
  });
}

// ─── Seed a workspace ───────────────────────────────────────────────

await fs.mkdir(join(wsDir, 'notes'), { recursive: true });
await fs.rm(shots, { recursive: true, force: true });
await fs.mkdir(shots, { recursive: true });
const notePath = join(wsDir, 'notes', 'plan.md');
await fs.writeFile(notePath, '# Launch plan\n\n- [x] Draft spec\n- [ ] Ship **node view**\n\n```ts\nconst ok = true;\n```\n');
await fs.writeFile(join(wsDir, 'canvas.json'), JSON.stringify({
  nodes: [
    {
      id: 'm1', type: 'mindmap', title: 'Topics', x: 0, y: 0, width: 520, height: 260, updatedAt: 1,
      data: {
        layout: 'right', rev: 1,
        root: { id: 'r', text: 'Canvas in Codex', children: [
          { id: 'a', text: 'MCP server', children: [] },
          { id: 'b', text: 'Node view', children: [] },
        ] },
      },
    },
    {
      id: 't1', type: 'text', title: 'Idea', x: 0, y: 300, width: 320, height: 60, updatedAt: 1,
      data: { content: '<p>Open nodes <strong>inside Codex</strong>.</p>', textColor: '', backgroundColor: '' },
    },
    { id: 'n1', type: 'file', title: 'Plan', x: 600, y: 0, width: 320, height: 240, updatedAt: 1, data: { filePath: notePath, content: '' } },
    { id: 'term', type: 'terminal', title: 'Dev server', x: 600, y: 300, width: 320, height: 200, updatedAt: 1, data: { cwd: '/tmp' } },
  ],
  edges: [],
  transform: { x: 0, y: 0, scale: 1 },
  savedAt: new Date().toISOString(),
}));
await fs.writeFile(join(storeDir, '__workspaces__.json'), JSON.stringify({ workspaces: [{ id: ws, name: 'Demo' }], activeId: ws }));

// ─── Server, host bundle, browser ───────────────────────────────────

const client = new Client({ name: 'node-view-e2e', version: '1' });
await client.connect(new StdioClientTransport({
  command: process.execPath,
  args: [cli, '--store-dir', storeDir, 'mcp', '--plugin-api', '1'],
  env: { ...process.env, HOME: workDir, PULSE_CANVAS_NODE_VIEW_HTML: nodeViewHtml },
}));
const html = (await client.readResource({ uri: 'ui://pulse-canvas/node.html' })).contents[0].text;
assert(html.includes('<div id="root">') && html.length > 500_000, 'server serves the app-built node view');

await build({
  configFile: false,
  logLevel: 'silent',
  build: {
    outDir: join(workDir, 'host'),
    lib: { entry: join(toolDir, 'host.ts'), formats: ['iife'], name: 'NodeViewE2eHost', fileName: () => 'host.js' },
  },
});
const hostScript = await fs.readFile(join(workDir, 'host', 'host.js'), 'utf-8');
const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});

async function openInHost(args) {
  const result = await client.callTool({ name: 'canvas_open', arguments: args });
  const page = await browser.newPage({ viewport: { width: 940, height: 960 } });
  page.on('pageerror', error => log('page error:', error.message));
  page.on('console', message => {
    if (message.type() === 'error') log('console error:', message.text());
  });
  await page.exposeFunction('hostCallTool', params => client.callTool(params));
  await page.setContent('<html><body style="margin:0;background:#e5e5e5"></body></html>');
  await page.addScriptTag({ content: hostScript });
  await page.evaluate(({ markup, input, output }) => window.startHost(markup, input, output), { markup: html, input: args, output: result });
  return { page, view: page.frameLocator('iframe'), result };
}

// ─── Mindmap: real component, edits persist ─────────────────────────

const mindmap = await openInHost({ nodeId: 'm1' });
await mindmap.view.locator('.mindmap-node-body').waitFor();
await waitFor(async () => (await mindmap.view.locator('.mindmap-topic').count()) === 3, 'mindmap renders with the app component');
assert((await mindmap.view.locator('.node-view-title').textContent()) === 'Topics', 'header shows the node title');
await sleep(300);
await mindmap.page.screenshot({ path: join(shots, '1-mindmap.png') });

const kid = mindmap.view.locator('.mindmap-topic-text', { hasText: 'Node view' });
await kid.dblclick();
await mindmap.page.keyboard.press('ControlOrMeta+A');
await mindmap.page.keyboard.type('Node view (real components)');
await mindmap.page.keyboard.press('Tab');
await mindmap.page.keyboard.type('Mindmap + text');
await mindmap.page.keyboard.press('Enter');
await waitFor(async () => {
  const branch = (await nodeOnDisk('m1')).data.root.children.find(child => child.id === 'b');
  return branch?.text === 'Node view (real components)' && branch.children?.[0]?.text === 'Mindmap + text';
}, 'mindmap edits (rename + new child) persist to the canvas');
await waitFor(async () => (await mindmap.page.evaluate(() => window.hostEvents))
  .some(event => event.type === 'context' && JSON.stringify(event.params).includes('Mindmap + text')), 'edited outline is published as model context');
await sleep(300);
await mindmap.page.screenshot({ path: join(shots, '2-mindmap-edited.png') });

// An agent edit made elsewhere shows up in the open view.
const current = (await nodeOnDisk('m1')).data.root;
await client.callTool({
  name: 'canvas_apply',
  arguments: { operations: [{ action: 'update', id: 'm1', data: { root: { ...current, children: [...current.children, { text: 'Added by agent' }] } } }] },
});
await waitFor(async () => (await mindmap.view.locator('.mindmap-topic-text', { hasText: 'Added by agent' }).count()) === 1, 'agent edits appear in the open view', 10_000);

// ─── Text: real tiptap body, edits persist as HTML ──────────────────

const textNode = await openInHost({ nodeId: 't1' });
await textNode.view.locator('.text-node-body').waitFor();
assert((await textNode.view.locator('.text-node-body strong').textContent()) === 'inside Codex', 'text node renders its stored HTML');
await textNode.view.locator('.text-node-body').dblclick();
await textNode.view.locator('.text-node-body .ProseMirror').waitFor();
await textNode.page.keyboard.press('ControlOrMeta+A');
await textNode.page.keyboard.type('Edited in the node view');
await textNode.view.locator('.node-view-header').click();
await waitFor(async () => (await nodeOnDisk('t1')).data.content.includes('Edited in the node view'), 'text edits persist as HTML content');
await textNode.page.screenshot({ path: join(shots, '3-text.png') });

// ─── File note (read-only), unsupported type, picker ────────────────

const note = await openInHost({ nodeId: 'n1' });
await waitFor(async () => (await note.view.locator('.node-view-file h1, .node-view-file h2, .node-view-file h3').first().textContent()) === 'Launch plan', 'file note renders its markdown read-only');
assert((await note.view.locator('.node-view-status').textContent()).length > 0, 'file note is marked read-only');
await note.page.screenshot({ path: join(shots, '4-note.png') });

const terminal = await openInHost({ nodeId: 'term' });
await waitFor(async () => (await terminal.view.locator('.node-view-unsupported').count()) === 1, 'live-only node types show an open-in-app message');

const picker = await openInHost({});
await waitFor(async () => (await picker.view.locator('.node-view-picker button').count()) === 3, 'picker lists mindmap, text, and note nodes');
await picker.view.locator('.node-view-picker button', { hasText: 'Topics' }).click();
await waitFor(async () => (await picker.view.locator('.mindmap-node-body').count()) === 1, 'picking a node opens it');
await picker.page.screenshot({ path: join(shots, '5-picker-opened.png') });

await browser.close();
await client.close();
await fs.rm(workDir, { recursive: true, force: true });
log(`ALL PASSED — screenshots in ${shots}`);
