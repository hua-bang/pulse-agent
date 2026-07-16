// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { collectTabRefsFromEditable, createMentionChipElement, renderMdWithMentions } from './mentions';
import { serializeEditable } from './serializeEditable';

const domLabel = 'header: Fancy Builder [...truncated]';

describe('chat mention rendering', () => {
  it('serializes DOM selection labels with bracket-safe encoding', () => {
    const chip = createMentionChipElement({
      type: 'dom',
      label: domLabel,
      nodeType: 'iframe',
      domSelection: {
        id: 'dom-1',
        label: domLabel,
        nodeId: 'node-1',
        selector: 'header',
      },
    });
    const editable = document.createElement('div');
    editable.appendChild(chip);

    expect(serializeEditable(editable)).toBe(`@[dom:dom-1|${encodeURIComponent(domLabel)}]`);
  });

  it('keeps a file path on file and folder chips for VS Code opening', () => {
    const fileChip = createMentionChipElement({
      type: 'file',
      label: 'src/main.ts',
      path: '/workspace/project/src/main.ts',
    });
    const folderChip = createMentionChipElement({
      type: 'folder',
      label: 'src/',
      path: '/workspace/project/src',
    });

    expect(fileChip.dataset.filePath).toBe('/workspace/project/src/main.ts');
    expect(fileChip.classList.contains('chat-mention-chip--clickable')).toBe(true);
    expect(folderChip.dataset.filePath).toBe('/workspace/project/src');
    expect(folderChip.classList.contains('chat-mention-chip--clickable')).toBe(true);
  });

  it('renders folder references with a root path for VS Code opening', () => {
    const html = renderMdWithMentions('@[folder:src/components] 目录', undefined, {
      rootFolder: '/workspace/project',
    });

    expect(html).toContain('data-file-path="/workspace/project/src/components"');
    expect(html).toContain('chat-mention-chip--clickable');
  });

  it('renders encoded DOM selection labels without leaking a closing bracket', () => {
    const html = renderMdWithMentions(`@[dom:dom-1|${encodeURIComponent(domLabel)}] 这描述了啥`);

    expect(html).toContain(domLabel);
    expect(html).not.toContain('</span>]');
  });

  it('keeps legacy DOM labels ending in a bracketed suffix inside the chip', () => {
    const html = renderMdWithMentions(`@[dom:dom-1|${domLabel}] 这描述了啥`);

    expect(html).toContain(domLabel);
    expect(html).not.toContain('</span>]');
  });

  it('uses a readable title when a selected session is inserted as a reference', () => {
    const chip = createMentionChipElement({
      type: 'session',
      label: '@[dom:dom-1|td%3A%20Latest%20commit] 这块区域描述了啥',
      sessionId: 'session-1',
      workspaceId: 'workspace-1',
    });

    expect(chip.dataset.mention).toBe('session:workspace-1:session-1:|td: Latest commit 这块区域描述了啥');
    expect(chip.textContent).toContain('td: Latest commit 这块区域描述了啥');
    expect(chip.textContent).not.toContain('dom-1');
  });

  it('serializes a link-tab mention and round-trips its ref through collection', () => {
    const chip = createMentionChipElement({
      type: 'tab',
      label: 'Pulse Canvas Docs',
      tab: {
        id: 'link:ab:cd',
        kind: 'link',
        title: 'Pulse Canvas Docs',
        url: 'https://example.com/docs',
        workspaceId: 'ws-1',
      },
    });
    const editable = document.createElement('div');
    editable.appendChild(chip);

    expect(serializeEditable(editable)).toBe(
      `@[tab:${encodeURIComponent('link:ab:cd')}|link|${encodeURIComponent('Pulse Canvas Docs')}]`,
    );

    const refs = collectTabRefsFromEditable(editable);
    expect(refs).toEqual([
      {
        id: 'link:ab:cd',
        kind: 'link',
        title: 'Pulse Canvas Docs',
        url: 'https://example.com/docs',
        workspaceId: 'ws-1',
        nodeId: undefined,
        artifactId: undefined,
        sessionId: undefined,
      },
    ]);
  });

  it('collects terminal and artifact tab refs with their kind-specific ids', () => {
    const editable = document.createElement('div');
    editable.appendChild(createMentionChipElement({
      type: 'tab',
      label: 'Dev Server',
      tab: { id: 'terminal:2', kind: 'terminal', title: 'Dev Server', workspaceId: 'ws-1', sessionId: 'workspace-terminal:ws-1:terminal:2' },
    }));
    editable.appendChild(createMentionChipElement({
      type: 'tab',
      label: 'Dashboard',
      tab: { id: 'artifact:ws-1:a1', kind: 'artifact', title: 'Dashboard', workspaceId: 'ws-1', artifactId: 'a1' },
    }));

    const refs = collectTabRefsFromEditable(editable);
    expect(refs.map((r) => [r.kind, r.sessionId ?? r.artifactId])).toEqual([
      ['terminal', 'workspace-terminal:ws-1:terminal:2'],
      ['artifact', 'a1'],
    ]);
  });

  it('renders a tab marker back into a styled chip in the transcript', () => {
    const html = renderMdWithMentions(`@[tab:${encodeURIComponent('link:ab:cd')}|link|${encodeURIComponent('Docs')}] 说说这个`);
    expect(html).toContain('chat-mention-chip--tab');
    expect(html).toContain('Docs');
    expect(html).toContain('说说这个');
  });
});
