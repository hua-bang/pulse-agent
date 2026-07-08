import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Window } from 'happy-dom';

type HappyDocument = InstanceType<typeof Window>['document'];
type StyledElement = NonNullable<ReturnType<HappyDocument['querySelector']>> & {
  style: { getPropertyValue: (property: string) => string };
};

const { canvasState, artifactState } = vi.hoisted(() => ({
  canvasState: {
    current: null as null | {
      nodes: Array<{
        id: string;
        type: string;
        title: string;
        x: number;
        y: number;
        width: number;
        height: number;
        data: Record<string, unknown>;
        updatedAt?: number;
      }>;
      edges: unknown[];
      transform: { x: number; y: number; scale: number };
      savedAt: string;
    },
  },
  artifactState: {
    current: null as null | {
      id: string;
      workspaceId: string;
      type: 'html' | 'svg' | 'mermaid';
      title: string;
      versions: Array<{ id: string; content: string; prompt?: string; createdAt: number }>;
      currentVersionId: string;
      updatedAt: number;
    },
  },
}));

vi.mock('./_shared/canvas-io', () => ({
  STORE_DIR: '/tmp/canvas-html-patch-tools-test',
  loadCanvas: vi.fn(async () => canvasState.current),
  saveCanvas: vi.fn(async (_workspaceId: string, data: unknown) => {
    canvasState.current = JSON.parse(JSON.stringify(data));
  }),
}));

vi.mock('./_shared/broadcast', () => ({
  broadcastUpdate: vi.fn(),
}));

vi.mock('../../artifacts/store', () => ({
  getArtifact: vi.fn(async (_workspaceId: string, artifactId: string) => (
    artifactState.current?.id === artifactId ? artifactState.current : null
  )),
  getCurrentVersionContent: vi.fn(async (_workspaceId: string, artifactId: string) => {
    const artifact = artifactState.current?.id === artifactId ? artifactState.current : null;
    if (!artifact) return null;
    const version = artifact.versions.find(item => item.id === artifact.currentVersionId) ?? artifact.versions.at(-1);
    return version ? { content: version.content, type: artifact.type, title: artifact.title } : null;
  }),
  addArtifactVersion: vi.fn(async (_workspaceId: string, artifactId: string, input: { content: string; prompt?: string }) => {
    const artifact = artifactState.current?.id === artifactId ? artifactState.current : null;
    if (!artifact) return null;
    const version = {
      id: `version-${artifact.versions.length + 1}`,
      content: input.content,
      prompt: input.prompt,
      createdAt: Date.now(),
    };
    artifactState.current = {
      ...artifact,
      versions: [...artifact.versions, version],
      currentVersionId: version.id,
      updatedAt: Date.now(),
    };
    return artifactState.current;
  }),
}));

function parseHtml(html: string): HappyDocument {
  const window = new Window();
  window.document.write(html);
  return window.document;
}

describe('html patch helpers', () => {
  it('applies ordered DOM operations and preserves full-document shape', async () => {
    const { patchHtmlContent } = await import('./_shared/html-patch');

    const result = patchHtmlContent(
      '<!DOCTYPE html><html><head><title>Demo</title></head><body><main><h1 id="hero-title">Old</h1><button id="cta" class="primary">Start</button><section class="cards"><article>A</article></section></main></body></html>',
      [
        { op: 'setText', selector: '#hero-title', text: 'New title' },
        { op: 'setAttribute', selector: '#cta', name: 'aria-label', value: 'Start countdown' },
        { op: 'setCssProperty', selector: '#cta', property: '--accent', value: '#ff0055' },
        { op: 'insertHTML', selector: '.cards', position: 'beforeend', html: '<article>B</article>' },
      ],
    );

    const document = parseHtml(result.html);
    expect(result.html).toMatch(/^<!DOCTYPE html>/);
    expect(document.querySelector('#hero-title')?.textContent).toBe('New title');
    expect(document.querySelector('#cta')?.getAttribute('aria-label')).toBe('Start countdown');
    expect((document.querySelector('#cta') as StyledElement).style.getPropertyValue('--accent')).toBe('#ff0055');
    expect(Array.from(document.querySelectorAll('.cards article')).map(node => node.textContent)).toEqual(['A', 'B']);
    expect(result.applied).toEqual([
      { op: 'setText', selector: '#hero-title', count: 1 },
      { op: 'setAttribute', selector: '#cta', count: 1 },
      { op: 'setCssProperty', selector: '#cta', count: 1 },
      { op: 'insertHTML', selector: '.cards', count: 1 },
    ]);
  });

  it('supports remove and replace operations', async () => {
    const { patchHtmlContent } = await import('./_shared/html-patch');

    const result = patchHtmlContent(
      '<main><h1 id="title" data-old="true">Old</h1><section class="hero"><p>Intro</p></section><button id="cta">Start</button></main>',
      [
        { op: 'removeAttribute', selector: '#title', name: 'data-old' },
        { op: 'replaceInnerHTML', selector: '.hero', html: '<strong>Updated</strong>' },
        { op: 'replaceOuterHTML', selector: '#cta', html: '<a id="cta" href="#start">Begin</a>' },
      ],
    );

    const document = parseHtml(result.html);
    expect(document.querySelector('#title')?.hasAttribute('data-old')).toBe(false);
    expect(document.querySelector('.hero')?.innerHTML).toBe('<strong>Updated</strong>');
    expect(document.querySelector('#cta')?.tagName).toBe('A');
    expect(document.querySelector('#cta')?.textContent).toBe('Begin');
    expect(result.applied).toEqual([
      { op: 'removeAttribute', selector: '#title', count: 1 },
      { op: 'replaceInnerHTML', selector: '.hero', count: 1 },
      { op: 'replaceOuterHTML', selector: '#cta', count: 1 },
    ]);
  });

  it('throws when a selector matches no elements', async () => {
    const { patchHtmlContent } = await import('./_shared/html-patch');

    expect(() => patchHtmlContent('<main></main>', [{ op: 'setText', selector: '#missing', text: 'Nope' }])).toThrow(
      'Selector matched no elements: #missing',
    );
  });

  it('can patch every selector match when all is true', async () => {
    const { patchHtmlContent } = await import('./_shared/html-patch');

    const result = patchHtmlContent(
      '<button class="item">A</button><button class="item">B</button>',
      [{ op: 'setAttribute', selector: '.item', all: true, name: 'data-state', value: 'ready' }],
    );

    const document = parseHtml(result.html);
    expect(Array.from(document.querySelectorAll('.item')).map(node => node.getAttribute('data-state'))).toEqual([
      'ready',
      'ready',
    ]);
    expect(result.applied).toEqual([{ op: 'setAttribute', selector: '.item', count: 2 }]);
  });

  it('preserves fragment HTML shape when the source is not a full document', async () => {
    const { patchHtmlContent } = await import('./_shared/html-patch');

    const result = patchHtmlContent(
      '<main><button id="cta">Start</button></main>',
      [{ op: 'setText', selector: '#cta', text: 'Begin' }],
    );

    expect(result.html).toBe('<main><button id="cta">Begin</button></main>');
  });

});

describe('canvas_patch_html_node', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    canvasState.current = {
      nodes: [
        {
          id: 'node-html',
          type: 'iframe',
          title: 'HTML Preview',
          x: 0,
          y: 0,
          width: 520,
          height: 400,
          data: {
            mode: 'html',
            html: '<!DOCTYPE html><html><body><h1 id="title">Old</h1><button id="cta">Start</button></body></html>',
          },
        },
        {
          id: 'node-note',
          type: 'file',
          title: 'Note',
          x: 600,
          y: 0,
          width: 320,
          height: 240,
          data: { content: 'hello' },
        },
        {
          id: 'node-artifact',
          type: 'iframe',
          title: 'Pinned Artifact',
          x: 840,
          y: 0,
          width: 520,
          height: 400,
          data: {
            artifactId: 'art-html',
          },
        },
      ],
      edges: [],
      transform: { x: 0, y: 0, scale: 1 },
      savedAt: new Date().toISOString(),
    };
    artifactState.current = {
      id: 'art-html',
      workspaceId: 'ws-html-patch-test',
      type: 'html',
      title: 'Artifact HTML',
      versions: [
        {
          id: 'version-1',
          content: '<!DOCTYPE html><html><body><h1 id="artifact-title">Old artifact</h1><button id="artifact-cta">Start</button></body></html>',
          createdAt: 1,
        },
      ],
      currentVersionId: 'version-1',
      updatedAt: 1,
    };
  });

  it('patches iframe node HTML and broadcasts the changed node', async () => {
    const { createHtmlPatchTools } = await import('./html-patch');
    const { saveCanvas } = await import('./_shared/canvas-io');
    const { broadcastUpdate } = await import('./_shared/broadcast');
    const tools = createHtmlPatchTools('ws-html-patch-test');

    const response = JSON.parse(await tools.canvas_patch_html_node.execute({
      nodeId: 'node-html',
      operations: [
        { op: 'setText', selector: '#title', text: 'Updated title' },
        { op: 'setAttribute', selector: '#cta', name: 'data-review', value: 'accepted' },
      ],
    }));

    expect(response.ok).toBe(true);
    expect(response.applied).toEqual([
      { op: 'setText', selector: '#title', count: 1 },
      { op: 'setAttribute', selector: '#cta', count: 1 },
    ]);
    const html = canvasState.current?.nodes[0].data.html as string;
    const document = parseHtml(html);
    expect(document.querySelector('#title')?.textContent).toBe('Updated title');
    expect(document.querySelector('#cta')?.getAttribute('data-review')).toBe('accepted');
    expect(canvasState.current?.nodes[0].updatedAt).toEqual(expect.any(Number));
    expect(saveCanvas).toHaveBeenCalledOnce();
    expect(broadcastUpdate).toHaveBeenCalledWith('ws-html-patch-test', ['node-html']);
  });

  it('patches an HTML artifact by adding a new current version', async () => {
    const { createHtmlPatchTools } = await import('./html-patch');
    const tools = createHtmlPatchTools('ws-html-patch-test');

    const response = JSON.parse(await tools.canvas_patch_html_node.execute({
      artifactId: 'art-html',
      prompt: 'review fix',
      operations: [
        { op: 'setText', selector: '#artifact-title', text: 'Updated artifact' },
        { op: 'setAttribute', selector: '#artifact-cta', name: 'data-review', value: 'accepted' },
      ],
    }));

    expect(response).toMatchObject({
      ok: true,
      target: 'artifact',
      artifactId: 'art-html',
      versionId: 'version-2',
      versionCount: 2,
    });
    expect(artifactState.current?.currentVersionId).toBe('version-2');
    expect(artifactState.current?.versions[1].prompt).toBe('review fix');
    const document = parseHtml(artifactState.current?.versions[1].content ?? '');
    expect(document.querySelector('#artifact-title')?.textContent).toBe('Updated artifact');
    expect(document.querySelector('#artifact-cta')?.getAttribute('data-review')).toBe('accepted');
  });

  it('patches artifact-backed iframe nodes through artifact versions', async () => {
    const { createHtmlPatchTools } = await import('./html-patch');
    const { saveCanvas } = await import('./_shared/canvas-io');
    const { broadcastUpdate } = await import('./_shared/broadcast');
    const tools = createHtmlPatchTools('ws-html-patch-test');

    const response = JSON.parse(await tools.canvas_patch_html_node.execute({
      nodeId: 'node-artifact',
      operations: [{ op: 'setText', selector: '#artifact-cta', text: 'Begin' }],
    }));

    expect(response).toMatchObject({
      ok: true,
      target: 'artifact',
      artifactId: 'art-html',
      versionId: 'version-2',
    });
    expect(saveCanvas).not.toHaveBeenCalled();
    expect(broadcastUpdate).not.toHaveBeenCalled();
    const document = parseHtml(artifactState.current?.versions[1].content ?? '');
    expect(document.querySelector('#artifact-cta')?.textContent).toBe('Begin');
  });

  it('does not save when the target is not an iframe HTML node', async () => {
    const { createHtmlPatchTools } = await import('./html-patch');
    const { saveCanvas } = await import('./_shared/canvas-io');
    const tools = createHtmlPatchTools('ws-html-patch-test');

    const response = JSON.parse(await tools.canvas_patch_html_node.execute({
      nodeId: 'node-note',
      operations: [{ op: 'setText', selector: '#title', text: 'Nope' }],
    }));

    expect(response).toMatchObject({ ok: false, error: 'node is not an iframe: node-note' });
    expect(saveCanvas).not.toHaveBeenCalled();
  });

  it('does not save when a patch operation fails', async () => {
    const { createHtmlPatchTools } = await import('./html-patch');
    const { saveCanvas } = await import('./_shared/canvas-io');
    const { broadcastUpdate } = await import('./_shared/broadcast');
    const tools = createHtmlPatchTools('ws-html-patch-test');

    const response = JSON.parse(await tools.canvas_patch_html_node.execute({
      nodeId: 'node-html',
      operations: [{ op: 'setText', selector: '#missing', text: 'Nope' }],
    }));

    expect(response).toMatchObject({ ok: false, error: 'Selector matched no elements: #missing' });
    expect(canvasState.current?.nodes[0].data.html).toContain('Old');
    expect(saveCanvas).not.toHaveBeenCalled();
    expect(broadcastUpdate).not.toHaveBeenCalled();
  });
});
