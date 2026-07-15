import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { readNode, getNodeCapabilities } from '../nodes';
import { saveCanvas } from '../store';
import { generateContext } from '../context';
import type { CanvasNode, CanvasSaveData } from '../types';

let testDir: string;

beforeEach(async () => {
  testDir = join(tmpdir(), `canvas-cli-modern-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`);
  await fs.mkdir(testDir, { recursive: true });
});

afterEach(async () => {
  await fs.rm(testDir, { recursive: true, force: true });
});

function makeNode(type: string, data: Record<string, unknown>, title = 'Node'): CanvasNode {
  return { id: `n-${type}`, type, title, x: 0, y: 0, width: 100, height: 100, data };
}

describe('getNodeCapabilities for modern types', () => {
  it('returns read-only for the app-produced types', () => {
    for (const t of ['text', 'iframe', 'image', 'shape', 'reference', 'dynamic-app', 'plugin']) {
      expect(getNodeCapabilities(t)).toEqual(['read']);
    }
  });

  it('falls back to read-only for an unknown future type', () => {
    expect(getNodeCapabilities('some-future-node')).toEqual(['read']);
  });
});

describe('readNode for modern node types', () => {
  it('reads a text node with content and styling', async () => {
    const node = makeNode('text', { content: '# Heading\n\nBody', fontSize: 14, color: '#333', extra: 'ignored' });
    const result = await readNode(node);
    expect(result.type).toBe('text');
    expect(result.content).toBe('# Heading\n\nBody');
    expect(result.fontSize).toBe(14);
    expect(result.color).toBe('#333');
    // Only the declared keys are surfaced.
    expect(result.extra).toBeUndefined();
  });

  it('reads an iframe node with its persisted metadata (including html/prompt)', async () => {
    const node = makeNode('iframe', {
      mode: 'url',
      url: 'https://example.com/viz',
      html: '<html>big body</html>',
      prompt: 'render a chart',
      artifactId: 'art-1',
      pageTitle: 'Trajectory Viz',
    });
    const result = await readNode(node);
    expect(result).toMatchObject({
      type: 'iframe',
      mode: 'url',
      url: 'https://example.com/viz',
      html: '<html>big body</html>',
      prompt: 'render a chart',
      artifactId: 'art-1',
      pageTitle: 'Trajectory Viz',
    });
  });

  it('reads an image node as its local file path only', async () => {
    const node = makeNode('image', { filePath: '/tmp/pic.png', alt: 'a picture' });
    const result = await readNode(node);
    expect(result).toMatchObject({ type: 'image', filePath: '/tmp/pic.png', alt: 'a picture' });
  });

  it('reads a shape node', async () => {
    const node = makeNode('shape', { shape: 'rect', text: 'Label', style: { fill: '#fff' } });
    const result = await readNode(node);
    expect(result).toMatchObject({ type: 'shape', shape: 'rect', text: 'Label', style: { fill: '#fff' } });
  });

  it('reads a dynamic-app node', async () => {
    const node = makeNode('dynamic-app', { url: 'https://app.example', dynamicAppId: 'app-9' });
    const result = await readNode(node);
    expect(result).toMatchObject({ type: 'dynamic-app', url: 'https://app.example', dynamicAppId: 'app-9' });
  });

  it('reads a plugin node with its payload', async () => {
    const payload = { foo: 'bar', nested: { n: 1 } };
    const node = makeNode('plugin', { pluginId: 'p1', nodeType: 'chart', version: '2.0', payload });
    const result = await readNode(node);
    expect(result).toMatchObject({ type: 'plugin', pluginId: 'p1', nodeType: 'chart', version: '2.0', payload });
  });

  it('surfaces raw data for an unknown future node type instead of dropping it', async () => {
    const node = makeNode('future-widget', { anything: 42 });
    const result = await readNode(node);
    expect(result.type).toBe('future-widget');
    expect(result.capabilities).toEqual(['read']);
    expect(result.data).toEqual({ anything: 42 });
  });
});

describe('context stays bounded for large modern nodes', () => {
  const bigHtml = '<html>' + 'x'.repeat(5000) + '</html>';
  const longText = 'A'.repeat(500);

  async function seedCanvas(): Promise<void> {
    const canvas: CanvasSaveData = {
      nodes: [
        makeNode('text', { content: longText }, 'Long Note'),
        makeNode('iframe', {
          mode: 'html',
          url: 'https://example.com/page',
          html: bigHtml,
          prompt: 'a very long prompt '.repeat(50),
          pageTitle: 'Path Viz',
        }, 'Embedded Page'),
      ],
      transform: { x: 0, y: 0, scale: 1 },
      savedAt: '2025-01-01T00:00:00.000Z',
    };
    await saveCanvas('ws-modern', canvas, testDir);
  }

  it('excerpts text and never inlines iframe html/prompt', async () => {
    await seedCanvas();
    const ctx = await generateContext('ws-modern', testDir);
    expect(ctx).not.toBeNull();

    const serialized = JSON.stringify(ctx);
    // The heavy fields must not leak into context.
    expect(serialized).not.toContain(bigHtml);
    expect(serialized).not.toContain('<html>');
    expect(serialized).not.toContain('a very long prompt a very long prompt');
    // And the full 500-char text body is not inlined verbatim.
    expect(serialized).not.toContain(longText);

    const textNode = ctx!.nodes.find(n => n.type === 'text')!;
    expect(String(textNode.excerpt).length).toBeLessThanOrEqual(201);
    expect(String(textNode.excerpt).endsWith('…')).toBe(true);

    const iframeNode = ctx!.nodes.find(n => n.type === 'iframe')!;
    expect(iframeNode.url).toBe('https://example.com/page');
    expect(iframeNode.mode).toBe('html');
    expect(iframeNode.pageTitle).toBe('Path Viz');
    expect(iframeNode.html).toBeUndefined();
    expect(iframeNode.prompt).toBeUndefined();
  });

  it('keeps the full text body reachable via readNode (what `node read` uses)', async () => {
    await seedCanvas();
    const node = makeNode('text', { content: longText });
    const full = await readNode(node);
    expect(full.content).toBe(longText);
  });

  it('formats new node types (and unknown ones) into the text context', async () => {
    const { formatContextAsText } = await import('../context');
    await seedCanvas();
    const ctx = await generateContext('ws-modern', testDir);
    const text = formatContextAsText(ctx!);
    expect(text).toContain('## Text');
    expect(text).toContain('## Embeds (iframe)');
    expect(text).toContain('https://example.com/page');
    // No raw HTML dumped into the human-readable form either.
    expect(text).not.toContain('<html>');
  });
});
