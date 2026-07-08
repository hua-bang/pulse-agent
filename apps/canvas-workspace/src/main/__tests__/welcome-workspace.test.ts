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
  it('seeds a five-frame onboarding canvas with notes, iframes, mindmap, and edges (zh)', async () => {
    const result = await ensureWelcomeWorkspaceSeeded(root, 'zh');

    expect(result).toEqual({ seeded: true, workspaceId: WELCOME_WORKSPACE_ID });

    const listing = await listWorkspaces(root);
    expect(listing.activeId).toBe(WELCOME_WORKSPACE_ID);
    expect(listing.workspaces).toEqual([
      { id: WELCOME_WORKSPACE_ID, name: WELCOME_WORKSPACE_NAME, rootFolder: undefined },
    ]);

    const canvas = await readCanvasFull(WELCOME_WORKSPACE_ID, root);
    const nodes = canvas.data?.nodes ?? [];
    const edges = (canvas.data?.edges ?? []) as Array<Record<string, unknown>>;

    // Five numbered course frames, left to right.
    const frames = nodes.filter((node) => node.type === 'frame');
    expect(frames).toHaveLength(5);
    expect(frames.map((frame) => frame.title)).toEqual([
      '01 · 初识 Pulse Canvas',
      '02 · 画布三要素',
      '03 · 组织信息',
      '04 · 与 AI 协作',
      '05 · 进阶玩法',
    ]);

    // Node-type variety: the onboarding canvas demonstrates the canvas, not
    // just documents. Counts are exact so accidental drops are caught.
    const byType = (type: string): number => nodes.filter((node) => node.type === type).length;
    expect(nodes).toHaveLength(32);
    expect(byType('file')).toBe(8);
    expect(byType('text')).toBe(8);
    expect(byType('iframe')).toBe(9);
    expect(byType('mindmap')).toBe(1);
    expect(byType('shape')).toBe(1);

    // Visual backbone: 8 styled HTML cards + 1 URL iframe (download page).
    const iframes = nodes.filter((node) => node.type === 'iframe');
    expect(iframes.filter((node) => node.data?.mode === 'html')).toHaveLength(8);
    expect(iframes.filter((node) => node.data?.mode === 'url')).toHaveLength(1);

    expect(canvas.data?.transform).toEqual({ x: 90, y: 40, scale: 0.55 });

    // The landing note keeps its stable id (deep-link target) and heading.
    const welcome = nodes.find((node) => node.id === 'node-welcome-note');
    expect(welcome?.title).toBe('欢迎使用 Pulse Canvas');
    expect(String(welcome?.data?.content)).toContain('Pulse Canvas 是一个本地优先的可视化工作区');
    expect(String(welcome?.data?.content)).toContain('产品说明书');

    // Every seeded note is persisted as a real markdown file whose content
    // matches the node.
    const fileNodes = nodes.filter((node) => node.type === 'file');
    for (const node of fileNodes) {
      const filePath = String(node.data?.filePath);
      expect(await fs.readFile(filePath, 'utf-8')).toBe(node.data?.content);
    }

    // Download page keeps its stable id and URL.
    const download = nodes.find((node) => node.id === 'node-welcome-download');
    expect(download?.data?.url).toBe('https://pulse-canvas-download.pages.dev/');

    // HTML-mode iframes carry inline HTML, URL-mode iframes carry URLs.
    const hero = nodes.find((node) => node.id === 'node-onboard-hero');
    expect(hero?.data?.mode).toBe('html');
    expect(String(hero?.data?.html)).toContain('Pulse <b>Canvas</b>');

    // Mindmap is the product capability map.
    const mindmap = nodes.find((node) => node.type === 'mindmap');
    const mindmapRoot = mindmap?.data?.root as { text: string; children: unknown[] };
    expect(mindmapRoot.text).toBe('Pulse Canvas');
    expect(mindmapRoot.children).toHaveLength(4);

    // Teaching edges: problem → answer (solid) and context → ideas (dashed).
    expect(edges).toHaveLength(2);
    const problemEdge = edges.find((edge) => edge.id === 'edge-onboard-problem-answer');
    expect(problemEdge).toMatchObject({
      source: { kind: 'node', nodeId: 'node-onboard-problem' },
      target: { kind: 'node', nodeId: 'node-onboard-answer' },
    });
    const contextEdge = edges.find((edge) => edge.id === 'edge-onboard-context-ideas');
    expect(contextEdge).toMatchObject({ stroke: { style: 'dashed' } });

    // Spatial containment: every non-frame node sits inside exactly one frame.
    for (const node of nodes) {
      if (node.type === 'frame') continue;
      const containing = frames.filter(
        (frame) =>
          Number(node.x) >= Number(frame.x) &&
          Number(node.y) >= Number(frame.y) &&
          Number(node.x) + Number(node.width) <= Number(frame.x) + Number(frame.width) &&
          Number(node.y) + Number(node.height) <= Number(frame.y) + Number(frame.height),
      );
      expect(containing, `node ${node.id} should be inside exactly one frame`).toHaveLength(1);
    }
  });

  it('seeds English welcome content when language is "en"', async () => {
    const result = await ensureWelcomeWorkspaceSeeded(root, 'en');

    expect(result).toEqual({ seeded: true, workspaceId: WELCOME_WORKSPACE_ID });

    const canvas = await readCanvasFull(WELCOME_WORKSPACE_ID, root);
    const nodes = canvas.data?.nodes ?? [];

    const welcome = nodes.find((node) => node.id === 'node-welcome-note');
    expect(welcome?.title).toBe('Welcome to Pulse Canvas');
    expect(String(welcome?.data?.content)).toContain('Pulse Canvas is a local-first visual workspace');
    expect(String(welcome?.data?.content)).toContain('product manual');

    const frames = nodes.filter((node) => node.type === 'frame');
    expect(frames.map((frame) => frame.title)).toEqual([
      '01 · Meet Pulse Canvas',
      '02 · Canvas Essentials',
      '03 · Organize Information',
      '04 · Work with AI',
      '05 · Go Deeper',
    ]);

    const mindmap = nodes.find((node) => node.type === 'mindmap');
    const mindmapRoot = mindmap?.data?.root as { text: string };
    expect(mindmapRoot.text).toBe('Pulse Canvas');
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
