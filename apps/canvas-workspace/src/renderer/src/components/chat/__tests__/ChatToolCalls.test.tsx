// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { I18nProvider } from '../../../i18n';
import { ChatToolCalls } from '../ChatMessage/ChatToolCalls';
import type { ToolCallStatus } from '../../../types';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement | null = null;
let root: Root | null = null;

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  window.localStorage.removeItem('pulse-canvas.language');
  host = null;
  root = null;
});

const renderToolCalls = (
  tools: ToolCallStatus[],
  expandedTools = new Set<number>(),
  isStreaming = false,
  liveDetailsOpen = false,
) => {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root?.render(
    <I18nProvider>
      <ChatToolCalls
        tools={tools}
        collapsed={false}
        expandedTools={expandedTools}
        showSectionHeader={false}
        isStreaming={isStreaming}
        liveDetailsOpen={liveDetailsOpen}
        onToggleSection={vi.fn()}
        onToggleToolExpand={vi.fn()}
      />
    </I18nProvider>,
  ));
};

const tabToolNames = [
  'dock_list_tabs',
  'dock_read_tab',
  'dock_activate_tab',
  'dock_open_tab',
  'browser_read_dom_selection',
] as const;

describe('ChatToolCalls tab tool labels', () => {
  it('describes each running and completed tab action instead of using generic execution copy', () => {
    const tools: ToolCallStatus[] = tabToolNames.flatMap((name, index) => ([
      { id: index * 2 + 1, name, status: 'running' },
      { id: index * 2 + 2, name, status: 'succeeded' },
    ]));

    renderToolCalls(tools);

    const labels = Array.from(host!.querySelectorAll('.chat-tool-call-label'))
      .map(element => element.textContent);
    expect(labels).toEqual([
      'Reading open Tabs',
      'Read open Tabs',
      'Reading Tab',
      'Read Tab',
      'Switching Tab',
      'Switched Tab',
      'Opening Tab',
      'Opened Tab',
      'Reading selected page element',
      'Read selected page element',
    ]);
    expect(host!.textContent).not.toContain('Executing');
    expect(host!.textContent).not.toContain('Executed');
  });

  it('uses explicit Chinese read, switch, and open labels for tab tools', () => {
    window.localStorage.setItem('pulse-canvas.language', 'zh');
    renderToolCalls(tabToolNames.map((name, index) => ({
      id: index + 1,
      name,
      status: 'succeeded',
    })));

    const labels = Array.from(host!.querySelectorAll('.chat-tool-call-label'))
      .map(element => element.textContent);
    expect(labels).toEqual([
      '已读取 Tab 列表',
      '已读取 Tab',
      '已切换 Tab',
      '已打开 Tab',
      '已读取页面选中元素',
    ]);
    expect(host!.textContent).not.toContain('已执行');
  });

  it('uses human actions for skill, clarification, and Tavily without repeating raw tool names', () => {
    renderToolCalls([
      { id: 31, name: 'skill', status: 'succeeded' },
      { id: 32, name: 'clarify', status: 'running' },
      { id: 33, name: 'tavily', status: 'running' },
    ]);

    const labels = Array.from(host!.querySelectorAll('.chat-tool-call-label'))
      .map(element => element.textContent);
    expect(labels).toEqual(['Read skill', 'Clarifying', 'Searching the web']);
    expect(host!.querySelectorAll('.chat-tool-call-name')).toHaveLength(0);
  });

  it('uses the bash description as the command row label when available', () => {
    renderToolCalls([{
      id: 34,
      name: 'bash',
      status: 'succeeded',
      args: {
        command: 'gh pr list --search magibook',
        description: 'Search Feishu docs and chats for magibook CLI references',
      },
      result: '{"output":"done","exitCode":0}',
    }]);

    expect(host!.querySelector('.chat-tool-call-label')?.textContent)
      .toBe('Search Feishu docs and chats for magibook CLI references');
    expect(host!.querySelector('.chat-tool-call-name')).toBeNull();
    expect(host!.querySelector('.chat-tool-call-sig')?.getAttribute('title'))
      .toContain('gh pr list --search magibook');
  });

  it('uses key arguments for filesystem and search tool row labels', () => {
    renderToolCalls([
      {
        id: 35,
        name: 'read',
        status: 'succeeded',
        args: { filePath: '/workspace/apps/canvas-workspace/src/App.tsx' },
        result: 'source',
      },
      {
        id: 36,
        name: 'write',
        status: 'succeeded',
        args: { file_path: '/workspace/tmp/report.md', content: '# Report' },
        result: 'ok',
      },
      {
        id: 37,
        name: 'edit',
        status: 'succeeded',
        args: { filePath: '/workspace/packages/core/index.ts', oldString: 'before', newString: 'after' },
        result: 'ok',
      },
      {
        id: 38,
        name: 'grep',
        status: 'succeeded',
        args: { pattern: 'magibook', path: 'apps packages' },
        result: 'matches',
      },
      {
        id: 39,
        name: 'ls',
        status: 'succeeded',
        args: { path: 'apps/canvas-workspace' },
        result: 'files',
      },
    ]);

    const labels = Array.from(host!.querySelectorAll('.chat-tool-call-label'))
      .map(element => element.textContent);
    expect(labels).toEqual([
      'Read /workspace/apps/canvas-workspace/src/App.tsx',
      'Write /workspace/tmp/report.md',
      'Edit /workspace/packages/core/index.ts',
      'Search "magibook" in apps packages',
      'List apps/canvas-workspace',
    ]);
    expect(host!.textContent).not.toContain('Read file');
    expect(host!.textContent).not.toContain('Search files');
    expect(host!.textContent).not.toContain('List directory');
    expect(host!.querySelectorAll('.chat-tool-call-name')).toHaveLength(0);
  });

  it('still falls back to localized labels when a tool has no descriptive args', () => {
    renderToolCalls([{ id: 40, name: 'read', status: 'succeeded' }]);

    expect(host!.querySelector('.chat-tool-call-label')?.textContent).toBe('Read file');
  });

  it('keeps a completed tab result persistently expandable without an undo claim', () => {
    renderToolCalls([{
      id: 42,
      name: 'dock_read_tab',
      status: 'succeeded',
      args: { tabId: 'tab-1' },
      result: 'Readable tab contents',
    }], new Set([42]));

    expect(host!.querySelector('.chat-tool-call-header--expandable')?.getAttribute('aria-expanded')).toBe('true');
    expect(host!.querySelector('.chat-tool-call-result')?.textContent).toContain('Readable tab contents');
    expect(host!.textContent).not.toMatch(/undo|撤销/i);
  });

  it('keeps live tool details out of the layout until the activity row expands them', () => {
    renderToolCalls([{
      id: 44,
      name: 'bash',
      status: 'running',
      args: { description: 'Search GitHub pull requests' },
    }], new Set(), true);

    const reveal = host!.querySelector('.chat-tool-details-reveal');
    expect(reveal?.classList.contains('chat-tool-details-reveal--open')).toBe(false);
    expect(reveal?.getAttribute('aria-hidden')).toBe('true');
  });

  it('shows a capability-level tab activation failure without forcing raw details open', () => {
    renderToolCalls([{
      id: 43,
      name: 'dock_activate_tab',
      status: 'succeeded',
      args: { tabId: 'closed-tab' },
      result: JSON.stringify({ ok: false, error: 'Tab closed-tab is not open' }),
    }]);

    const row = host!.querySelector('.chat-tool-call');
    expect(row?.classList.contains('chat-tool-call--failed')).toBe(true);
    expect(row?.querySelector('.chat-tool-call-label')?.textContent).toBe('Could not switch Tab');
    expect(row?.textContent).not.toContain('Switched Tab');
    expect(row?.querySelector('.chat-tool-call-header')?.getAttribute('aria-expanded')).toBe('false');
    expect(row?.querySelector('.chat-tool-call-result')).toBeNull();
  });
});
