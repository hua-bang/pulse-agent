import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  WELCOME_WORKSPACE_ID,
  WELCOME_WORKSPACE_NAME,
  ensureWelcomeWorkspaceSeeded,
} from '../canvas/welcome-workspace';
import { readCanvasFull } from '../canvas/storage';
import { saveCanvas } from '../canvas/service';
import { listWorkspaces, WORKSPACES_MANIFEST_FILENAME } from '../canvas/workspaces';

let root: string;

beforeEach(async () => {
  root = join(tmpdir(), `welcome-workspace-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  await fs.mkdir(root, { recursive: true });
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

async function writeManifest(payload: unknown): Promise<void> {
  await fs.writeFile(join(root, WORKSPACES_MANIFEST_FILENAME), JSON.stringify(payload), 'utf-8');
}

describe('welcome workspace seed', () => {
  it('seeds a first-run workspace with welcome notes and a local download card', async () => {
    const result = await ensureWelcomeWorkspaceSeeded(root, 'zh');

    expect(result).toEqual({ seeded: true, workspaceId: WELCOME_WORKSPACE_ID });

    const listing = await listWorkspaces(root);
    expect(listing.activeId).toBe(WELCOME_WORKSPACE_ID);
    expect(listing.workspaces).toEqual([
      { id: WELCOME_WORKSPACE_ID, name: WELCOME_WORKSPACE_NAME, rootFolder: undefined },
    ]);

    const canvas = await readCanvasFull(WELCOME_WORKSPACE_ID, root);
    expect(canvas.data?.nodes).toHaveLength(3);
    expect(canvas.data?.transform).toEqual({
      x: 86.65451428822593,
      y: 15.931529823069752,
      scale: 0.5567047770115934,
    });

    const note = canvas.data?.nodes?.find((node) => node.type === 'file');
    const iframe = canvas.data?.nodes?.find((node) => node.type === 'iframe');
    const detail = canvas.data?.nodes?.find((node) => node.title === 'Pulse Canvas 使用详细');

    expect(note?.title).toBe('欢迎使用 Pulse Canvas');
    expect(note).toMatchObject({ x: 56, y: 80, width: 503, height: 453 });
    expect(note?.data?.content).toContain('Pulse Canvas 是一个本地优先的可视化工作区');
    expect(typeof note?.data?.filePath).toBe('string');
    expect(await fs.readFile(String(note?.data?.filePath), 'utf-8')).toContain('欢迎使用 Pulse Canvas');

    expect(iframe?.title).toBe('Pulse Canvas Download');
    expect(iframe).toMatchObject({ x: 648, y: 80, width: 1191, height: 1369 });
    expect(iframe?.data).toMatchObject({
      mode: 'html',
      url: '',
      html: '',
    });
    expect(iframe?.data?.localUrl).toContain('pulse-canvas://app/download-site/index.html?');
    expect(iframe?.data?.localUrl).toContain('lang=zh');
    expect(iframe?.data?.localUrl).toContain('manifest=https%3A%2F%2Fpulse-canvas-download.pages.dev%2Flatest.json');

    expect(detail).toMatchObject({ x: 56, y: 584.5, width: 502, height: 853 });
    expect(detail?.data?.content).toContain('## 1. 先把工作区连到项目');
    expect(detail?.data?.content).toContain('Cmd/Ctrl+Shift+A');
    expect(await fs.readFile(String(detail?.data?.filePath), 'utf-8')).toBe(detail?.data?.content);
  });

  it('seeds English welcome content when language is "en"', async () => {
    const result = await ensureWelcomeWorkspaceSeeded(root, 'en');

    expect(result).toEqual({ seeded: true, workspaceId: WELCOME_WORKSPACE_ID });

    const canvas = await readCanvasFull(WELCOME_WORKSPACE_ID, root);
    const note = canvas.data?.nodes?.find((node) => node.type === 'file' && node.id !== 'node-welcome-detail');
    const detail = canvas.data?.nodes?.find((node) => node.id === 'node-welcome-detail');
    const download = canvas.data?.nodes?.find((node) => node.id === 'node-welcome-download');

    expect(note?.title).toBe('Welcome to Pulse Canvas');
    expect(note?.data?.content).toContain('Pulse Canvas is a local-first visual workspace');
    expect(detail?.title).toBe('Pulse Canvas — Detailed Usage');
    expect(detail?.data?.content).toContain('## 1. Connect the workspace to your project');
    expect(download?.data?.localUrl).toContain('lang=en');
  });

  it('migrates the untouched remote Welcome download node to local HTML', async () => {
    await ensureWelcomeWorkspaceSeeded(root, 'zh');
    const before = await readCanvasFull(WELCOME_WORKSPACE_ID, root);
    const nodes = (before.data?.nodes ?? []).map((node) => node.id === 'node-welcome-download'
      ? { ...node, data: { ...node.data, mode: 'url', url: 'https://pulse-canvas-download.pages.dev/', html: '' } }
      : node);
    await saveCanvas(WELCOME_WORKSPACE_ID, { ...before.data!, nodes }, { root });

    await expect(ensureWelcomeWorkspaceSeeded(root, 'zh')).resolves.toEqual({ seeded: false });

    const after = await readCanvasFull(WELCOME_WORKSPACE_ID, root);
    const download = after.data?.nodes?.find((node) => node.id === 'node-welcome-download');
    expect(download?.data).toMatchObject({ mode: 'html', url: '', html: '' });
    expect(download?.data?.localUrl).toContain('pulse-canvas://app/download-site/index.html?');
  });

  it('does not seed when a manifest already has workspaces', async () => {
    await writeManifest({
      activeId: 'ws-existing',
      workspaces: [{ id: 'ws-existing', name: 'Existing' }],
      folders: [],
    });

    const result = await ensureWelcomeWorkspaceSeeded(root);

    expect(result.seeded).toBe(false);
    const listing = await listWorkspaces(root);
    expect(listing.workspaces).toEqual([
      { id: 'ws-existing', name: 'Existing', rootFolder: undefined },
    ]);
    await expect(fs.access(join(root, WELCOME_WORKSPACE_ID, 'canvas.json'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('does not seed when workspace data already exists without a manifest', async () => {
    await fs.mkdir(join(root, 'ws-orphan'), { recursive: true });

    const result = await ensureWelcomeWorkspaceSeeded(root);

    expect(result.seeded).toBe(false);
    const listing = await listWorkspaces(root);
    expect(listing.workspaces).toEqual([
      { id: 'ws-orphan', name: 'ws-orphan' },
    ]);
    await expect(fs.access(join(root, WORKSPACES_MANIFEST_FILENAME))).rejects.toMatchObject({ code: 'ENOENT' });
  });
});
