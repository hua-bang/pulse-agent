import { existsSync } from 'node:fs';
import { promises as fs } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { HARNESS_DIR, STORE_RELATIVE_DIR } from './config.mjs';
import { HarnessError } from './errors.mjs';

export async function prepareProfile(profile, opts) {
  if (profile === 'temp') {
    const home = await fs.mkdtemp(join(tmpdir(), 'pulse-canvas-harness-home-'));
    return { home, cleanupHome: true };
  }

  if (profile === 'demo') {
    const home = join(HARNESS_DIR, 'demo-home');
    if (opts.reset) await fs.rm(home, { recursive: true, force: true });
    await seedDemoHome(home);
    return { home, workspaceId: 'harness-demo', cleanupHome: false };
  }

  if (profile === 'clone') {
    if (!opts.workspace) throw new HarnessError('profile=clone requires --workspace <id>.');
    const home = await fs.mkdtemp(join(tmpdir(), 'pulse-canvas-harness-clone-home-'));
    await cloneWorkspaceToHome(opts.workspace, home);
    return { home, workspaceId: opts.workspace, sourceWorkspaceId: opts.workspace, cleanupHome: true };
  }

  if (profile === 'real') {
    if (!opts['allow-real-writes']) {
      throw new HarnessError('profile=real requires --allow-real-writes.');
    }
    return { home: homedir(), workspaceId: opts.workspace, cleanupHome: false };
  }

  throw new HarnessError(`Unknown profile: ${profile}`);
}

export function collectFlags(opts) {
  const flags = new Set(opts.flag ?? []);
  if (opts['enable-webview-page-control']) flags.add('webview-page-control');
  return [...flags].filter(Boolean);
}

export async function writeExperimentalFlags(flags, artifactsDir) {
  const flagsPath = join(artifactsDir, 'experimental-features.json');
  const payload = Object.fromEntries(flags.map((flag) => [flag, true]));
  await fs.writeFile(flagsPath, JSON.stringify(payload, null, 2));
  return flagsPath;
}

async function seedDemoHome(home) {
  const storeDir = join(home, STORE_RELATIVE_DIR);
  const workspaceId = 'harness-demo';
  const workspaceDir = join(storeDir, workspaceId);
  const notesDir = join(workspaceDir, 'notes');
  await fs.mkdir(notesDir, { recursive: true });
  const notePath = join(notesDir, 'Harness_Demo-node-harness-note.md');
  const noteContent = [
    '# Harness Demo',
    '',
    'This workspace is created by the Pulse Canvas harness.',
    '',
    '- Use `harness screenshot` to capture the app.',
    '- Use `harness click` / `harness press` to operate the window.',
    '- Use clone or real profiles when a specific workspace is needed.',
  ].join('\n');
  await fs.writeFile(notePath, noteContent, 'utf8');
  const webviewFixturePath = join(workspaceDir, 'webview-input-fixture.html');
  await fs.writeFile(webviewFixturePath, [
    '<!doctype html>',
    '<meta charset="utf-8">',
    '<title>Harness WebView Input Fixture</title>',
    '<label for="guest-input">Guest input</label>',
    '<input id="guest-input" autocomplete="off">',
  ].join('\n'), 'utf8');
  await fs.writeFile(join(storeDir, '__workspaces__.json'), JSON.stringify({
    workspaces: [{ id: workspaceId, name: 'Harness Demo' }],
    folders: [],
    activeId: workspaceId,
  }, null, 2));
  const now = Date.now();
  await fs.writeFile(join(workspaceDir, 'canvas.json'), JSON.stringify({
    schemaVersion: 1,
    nodes: [
      {
        id: 'node-harness-note',
        type: 'file',
        title: 'Harness Demo',
        x: 80,
        y: 80,
        width: 520,
        height: 420,
        data: { filePath: notePath, content: noteContent, saved: true, modified: false },
        updatedAt: now,
      },
      {
        id: 'node-harness-frame',
        type: 'frame',
        title: 'Agent verification area',
        x: 640,
        y: 80,
        width: 640,
        height: 420,
        data: { color: 'oklch(0.68 0.108 224)' },
        updatedAt: now,
      },
      {
        id: 'node-harness-web',
        type: 'iframe',
        title: 'WebView Input Fixture',
        x: 680,
        y: 150,
        width: 560,
        height: 320,
        data: { url: pathToFileURL(webviewFixturePath).href, html: '', mode: 'url', prompt: '' },
        updatedAt: now,
      },
    ],
    edges: [],
    transform: { x: 0, y: 0, scale: 1 },
    savedAt: new Date().toISOString(),
  }, null, 2));
}

async function cloneWorkspaceToHome(workspaceId, home) {
  const sourceStore = join(homedir(), STORE_RELATIVE_DIR);
  const sourceWorkspace = join(sourceStore, workspaceId);
  if (!existsSync(sourceWorkspace)) throw new HarnessError(`Workspace not found in real HOME: ${workspaceId}`);
  const targetStore = join(home, STORE_RELATIVE_DIR);
  const targetWorkspace = join(targetStore, workspaceId);
  await fs.mkdir(targetStore, { recursive: true });
  await fs.cp(sourceWorkspace, targetWorkspace, { recursive: true });

  let entry = { id: workspaceId, name: workspaceId };
  try {
    const manifest = JSON.parse(await fs.readFile(join(sourceStore, '__workspaces__.json'), 'utf8'));
    entry = manifest.workspaces?.find((workspace) => workspace.id === workspaceId) ?? entry;
  } catch {
    // Keep fallback entry.
  }
  await fs.writeFile(join(targetStore, '__workspaces__.json'), JSON.stringify({
    workspaces: [entry],
    folders: [],
    activeId: workspaceId,
  }, null, 2));
}
