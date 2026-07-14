import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { WorkspaceNodeListItem } from '../../../types';
import { CardShell } from '../CardShell';
import { NodeCardPreview, getNodeCardPreviewModel } from '../NodeCardPreview';

const listItem = (
  type: string,
  overrides: Partial<WorkspaceNodeListItem> = {},
): WorkspaceNodeListItem => ({
  workspaceId: 'workspace-1',
  workspaceName: 'Research',
  id: `${type}-1`,
  type,
  title: `${type} title`,
  summary: 'First point. Second point. Third point.',
  tags: ['product', 'research'],
  hasData: true,
  linkCount: 2,
  ...overrides,
});

describe('NodeCardPreview', () => {
  it('derives typed previews from list-item fields only', () => {
    expect(getNodeCardPreviewModel(listItem('file'), 'File title', 'Empty')).toMatchObject({
      kind: 'file',
      sections: ['First point', 'Second point', 'Third point.'],
    });
    expect(getNodeCardPreviewModel(listItem('text'), 'Text title', 'Empty')).toMatchObject({
      kind: 'text',
      excerpt: 'First point. Second point. Third point.',
    });
    expect(getNodeCardPreviewModel(
      listItem('iframe', { summary: 'https://www.example.com/library A useful source.' }),
      'Web title',
      'Empty',
    )).toMatchObject({
      kind: 'iframe',
      source: 'example.com',
      excerpt: 'A useful source.',
    });
    expect(getNodeCardPreviewModel(
      listItem('iframe', { summary: 'file:///tmp/research-source.html' }),
      'Local source',
      'Empty',
    )).toMatchObject({
      kind: 'iframe',
      source: 'research-source.html',
      excerpt: 'Empty',
    });
    expect(getNodeCardPreviewModel(listItem('image'), 'Image title', 'Empty')).toMatchObject({
      kind: 'image',
    });
    expect(getNodeCardPreviewModel(listItem('mindmap', {
      mindmapPreview: { root: 'Research methods', branches: ['Interviews', 'Field notes'] },
    }), 'Mindmap title', 'Empty')).toMatchObject({
      kind: 'mindmap',
      root: 'Research methods',
      branches: ['Interviews', 'Field notes'],
    });
  });

  it('keeps web previews lightweight and lazily renders an available image thumbnail', () => {
    const web = renderToStaticMarkup(
      <NodeCardPreview
        node={listItem('iframe', { summary: 'https://example.com A useful source.' })}
        title="Web title"
        emptyLabel="Empty"
      />,
    );
    const image = renderToStaticMarkup(
      <NodeCardPreview
        node={listItem('image', { previewPath: '/tmp/reference.png' })}
        title="Image title"
        emptyLabel="Empty"
      />,
    );

    expect(web).toContain('data-preview-kind="iframe"');
    expect(image).toContain('data-preview-kind="image"');
    expect(web).not.toMatch(/<(?:iframe|img|webview)\b/i);
    expect(image).toContain('<img src="pulse-canvas://local/tmp/reference.png" alt="" loading="lazy" decoding="async"/>');
  });

  it('uses a confirmed AI insight before the raw source preview', () => {
    expect(getNodeCardPreviewModel(
      listItem('iframe', {
        summary: 'https://example.com Long source description.',
        aiSummary: 'A concise, confirmed reading aid.',
      }),
      'Web title',
      'Empty',
    )).toMatchObject({
      kind: 'ai-summary',
      excerpt: 'A concise, confirmed reading aid.',
      source: 'example.com',
    });

    const html = renderToStaticMarkup(
      <NodeCardPreview
        node={listItem('text', { aiSummary: 'Confirmed synthesis.' })}
        title="Text title"
        emptyLabel="Empty"
        aiSummaryLabel="AI insight"
        confirmedLabel="Confirmed"
      />,
    );

    expect(html).toContain('data-preview-kind="ai-summary"');
    expect(html).toContain('Confirmed synthesis.');
  });

  it('keeps empty source nodes compact instead of rendering no-preview copy', () => {
    expect(getNodeCardPreviewModel(
      listItem('text', { summary: '' }),
      'Text title',
      'No preview available.',
    )).toEqual({ kind: 'empty' });

    const html = renderToStaticMarkup(
      <NodeCardPreview
        node={listItem('file', { summary: '' })}
        title="File title"
        emptyLabel="No preview available."
      />,
    );

    expect(html).toBe('');
  });

  it('uses one native button shell for the whole card interaction', () => {
    const html = renderToStaticMarkup(
      <CardShell kind="text" selected openLabel="Open note in side peek" onOpen={vi.fn()}>
        <span>Note</span>
      </CardShell>,
    );

    expect(html).toContain('<article class="knowledge-node-card knowledge-node-card--text is-selected">');
    expect(html).toContain('class="ui-btn ui-btn--secondary ui-btn--md knowledge-node-card__button"');
    expect(html).toContain('aria-label="Open note in side peek" aria-current="true"');
    expect(html.match(/<button\b/g)).toHaveLength(1);
  });
});
