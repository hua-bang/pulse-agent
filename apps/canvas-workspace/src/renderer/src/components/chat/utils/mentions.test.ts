// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { buildTabMentionItems, collectTabRefsFromEditable, createMentionChipElement, parseTabMention, renderMdWithMentions } from './mentions';
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
        dockWorkspaceId: 'dock-ws-2',
      },
    });
    const editable = document.createElement('div');
    editable.appendChild(chip);

    const serialized = serializeEditable(editable);
    expect(serialized).toContain(
      `@[tab:${encodeURIComponent('link:ab:cd')}|link|${encodeURIComponent('dock-ws-2')}|${encodeURIComponent('Pulse Canvas Docs')}|ref=`,
    );
    expect(parseTabMention(serialized.slice(2, -1))).toEqual({
      id: 'link:ab:cd',
      kind: 'link',
      label: 'Pulse Canvas Docs',
      url: 'https://example.com/docs',
      workspaceId: 'ws-1',
      dockWorkspaceId: 'dock-ws-2',
    });

    const refs = collectTabRefsFromEditable(editable);
    expect(refs).toEqual([
      {
        id: 'link:ab:cd',
        kind: 'link',
        title: 'Pulse Canvas Docs',
        url: 'https://example.com/docs',
        workspaceId: 'ws-1',
        dockWorkspaceId: 'dock-ws-2',
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

  it('round-trips persisted identity when a legacy caller has no dock workspace', () => {
    const chip = createMentionChipElement({
      type: 'tab',
      label: 'Docs',
      tab: {
        id: 'link:docs',
        kind: 'link',
        title: 'Docs',
        url: 'https://example.com/docs',
      },
    });
    const editable = document.createElement('div');
    editable.appendChild(chip);

    const serialized = serializeEditable(editable);
    expect(parseTabMention(serialized.slice(2, -1))).toEqual({
      id: 'link:docs',
      kind: 'link',
      label: 'Docs',
      dockWorkspaceId: undefined,
      url: 'https://example.com/docs',
    });
  });

  it('keeps a localized disambiguation label on a tab candidate and its composer chip', () => {
    const [item] = buildTabMentionItems([{
      id: 'canvas:workspace-2',
      kind: 'canvas',
      title: 'Roadmap',
      workspaceId: 'workspace-2',
      dockWorkspaceId: 'workspace-1',
      isActive: true,
    }], () => 'Canvas · Product · Current tab');

    expect(item.description).toBe('Canvas · Product · Current tab');
    const chip = createMentionChipElement(item);
    expect(chip.dataset.nodeType).toBe('workspace');
    expect(chip.querySelector('.chat-mention-chip-meta')?.textContent)
      .toBe('Canvas · Product · Current tab');
    expect(chip.getAttribute('aria-label'))
      .toBe('Roadmap · Canvas · Product · Current tab');
  });

  it('renders a tab marker back into a clickable jump chip in the transcript', () => {
    const html = renderMdWithMentions(`@[tab:${encodeURIComponent('link:ab:cd')}|link|${encodeURIComponent('dock-ws-2')}|${encodeURIComponent('Docs')}] 说说这个`);
    expect(html).toContain('chat-mention-chip--tab');
    expect(html).toContain('chat-mention-chip--clickable');
    expect(html).toContain('data-action="tab-jump"');
    expect(html).toContain('data-tab-id="link:ab:cd"');
    expect(html).toContain('data-dock-workspace-id="dock-ws-2"');
    expect(html).toContain('Docs');
    expect(html).toContain('说说这个');
  });

  it('keeps legacy tab markers readable without inventing reopen identity', () => {
    expect(parseTabMention('tab:link%3Alegacy|link|Legacy%20docs')).toEqual({
      id: 'link:legacy',
      kind: 'link',
      label: 'Legacy docs',
      dockWorkspaceId: undefined,
    });
    expect(parseTabMention('tab:link%3Acurrent|link|dock-ws|Current%20docs')).toEqual({
      id: 'link:current',
      kind: 'link',
      label: 'Current docs',
      dockWorkspaceId: 'dock-ws',
    });
  });

  it('renders persisted tab identity as transcript data attributes', () => {
    const identity = Array.from(new TextEncoder().encode(JSON.stringify({
      url: 'https://example.com/docs',
      workspaceId: 'workspace-2',
    })), (byte) => byte.toString(16).padStart(2, '0')).join('');
    const html = renderMdWithMentions(
      `@[tab:link%3Adocs|link|workspace-2|Product%20docs|ref=${identity}]`,
    );

    expect(html).toContain('data-tab-url="https://example.com/docs"');
    expect(html).toContain('data-tab-workspace-id="workspace-2"');
  });

  it('colors a transcript role chip from roleColors and falls back to the violet tokens otherwise', () => {
    const roleColors = new Map([['role-1', '#2383e2']]);

    const colored = renderMdWithMentions('@[role:role-1|产品经理] 先评估', undefined, { roleColors });
    expect(colored).toContain('chat-mention-chip--role');
    expect(colored).toContain('--role-accent:#2383e2');
    expect(colored).toContain('--role-accent-soft:rgba(35, 131, 226, 0.18)');
    expect(colored).toContain('产品经理');

    // Unknown (e.g. deleted) role id → class tokens only, no inline override.
    const fallback = renderMdWithMentions('@[role:role-gone|评审员] 你看看', undefined, { roleColors });
    expect(fallback).toContain('chat-mention-chip--role');
    expect(fallback).not.toContain('--role-accent:');
  });

  it('drops a non-#rrggbb role color instead of letting it into the style attribute', () => {
    const roleColors = new Map([['role-1', '"><img src=x onerror=alert(1)>']]);
    const html = renderMdWithMentions('@[role:role-1|产品经理] hi', undefined, { roleColors });
    expect(html).toContain('chat-mention-chip--role');
    expect(html).not.toContain('style=');
    expect(html).not.toContain('onerror');
  });

  it('chips the plain @Name an agent writes when handing off, with that role accent', () => {
    const roleNames = new Map([['张一鸣', '#2383e2'], ['华铧', '#a594e0']]);
    const html = renderMdWithMentions('@张一鸣 你觉得核心差距会转移到什么?', undefined, { roleNames });

    expect(html).toContain('chat-mention-chip--role');
    expect(html).toContain('--role-accent:#2383e2');
    expect(html).toContain('张一鸣');
    expect(html).not.toContain('@张一鸣');
  });

  it('longest name wins, unknown names and emails stay plain', () => {
    const roleNames = new Map([['评审', '#0f7b6c'], ['评审员', '#c14b42']]);
    const html = renderMdWithMentions('请 @评审员 把关,顺便抄送 a@b.com,别找 @路人', undefined, { roleNames });

    expect(html).toContain('--role-accent:#c14b42');
    expect(html).not.toContain('--role-accent:#0f7b6c');
    expect(html).toContain('a@b.com');
    expect(html).toContain('@路人');
  });

  it('never rewrites inside code blocks or tag attributes', () => {
    const roleNames = new Map([['张一鸣', '#2383e2']]);
    const html = renderMdWithMentions('看这段:`@张一鸣 是纯文本`', undefined, { roleNames });

    expect(html).toContain('@张一鸣');
    expect(html).not.toContain('chat-mention-chip--role');
  });

  it('leaves user content alone when roleNames is not supplied', () => {
    const html = renderMdWithMentions('@张一鸣 我随手打的', undefined, {});
    expect(html).not.toContain('chat-mention-chip--role');
    expect(html).toContain('@张一鸣');
  });

  it('carries the role accent inline on composer role chips and round-trips the marker', () => {
    const chip = createMentionChipElement({
      type: 'role',
      label: '产品经理',
      roleId: 'role-1',
      roleColor: '#d9730d',
    });
    expect(chip.style.getPropertyValue('--role-accent')).toBe('#d9730d');
    expect(chip.style.getPropertyValue('--role-accent-icon')).toBe('#d9730d');
    expect(chip.style.getPropertyValue('--role-accent-soft')).toBe('rgba(217, 115, 13, 0.18)');

    const editable = document.createElement('div');
    editable.appendChild(chip);
    expect(serializeEditable(editable)).toBe('@[role:role-1|产品经理]');
  });
});
