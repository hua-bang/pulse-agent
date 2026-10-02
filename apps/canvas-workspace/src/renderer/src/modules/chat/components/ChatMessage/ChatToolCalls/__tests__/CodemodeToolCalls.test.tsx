// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { I18nProvider } from '../../../../../../i18n';
import { ChatToolCalls } from '..';
import { groupCodemodeCalls, parseCodemodeResult } from '../codemodeResult';
import type { ToolCallStatus } from '../../../../../../types';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement | null = null;
let root: Root | null = null;

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  host = null;
  root = null;
});

const call = (n: number, name: string, status: string, extra: Record<string, unknown> = {}) => ({
  id: `call_1:${n}`, parentToolCallId: 'call_1', name, status, durationMs: 10, ...extra,
});

const codemodeTool = (result: Record<string, unknown>, status: ToolCallStatus['status'] = 'succeeded'): ToolCallStatus => ({
  id: 1,
  name: 'codemode',
  toolCallId: 'call_1',
  status,
  args: { code: 'const r = await tools.canvas_search_nodes({});\nreturn r.length;' },
  result: JSON.stringify(result),
});

const render = (tools: ToolCallStatus[], expanded = new Set<number>()) => {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root?.render(
    <I18nProvider>
      <ChatToolCalls
        tools={tools}
        collapsed={false}
        expandedTools={expanded}
        showSectionHeader={false}
        onToggleSection={vi.fn()}
        onToggleToolExpand={vi.fn()}
      />
    </I18nProvider>,
  ));
};

describe('Codemode result parsing', () => {
  it('reads nested calls, explicit output and the return value', () => {
    const view = parseCodemodeResult(codemodeTool({
      ok: true,
      output: ['total 3'],
      value: { total: 3 },
      calls: [call(1, 'canvas_search_nodes', 'succeeded'), call(2, 'canvas_read_node', 'failed', { error: 'missing' })],
    }));

    expect(view).toMatchObject({ ok: true, output: ['total 3'], value: { total: 3 }, hasValue: true, failedCalls: 1 });
    expect(view?.calls.map(item => item.status)).toEqual(['succeeded', 'failed']);
  });

  it('ignores other tools and results without a calls list', () => {
    expect(parseCodemodeResult({ name: 'bash', result: '{"calls":[]}' })).toBeNull();
    expect(parseCodemodeResult({ name: 'codemode', result: 'not json' })).toBeNull();
    expect(parseCodemodeResult({ name: 'codemode', result: '{"ok":true}' })).toBeNull();
  });

  it('groups consecutive identical outcomes but keeps every failure visible', () => {
    const groups = groupCodemodeCalls([
      { name: 'canvas_read_node', status: 'succeeded', durationMs: 5 },
      { name: 'canvas_read_node', status: 'succeeded', durationMs: 7 },
      { name: 'canvas_read_node', status: 'failed', error: 'a' },
      { name: 'canvas_read_node', status: 'failed', error: 'b' },
      { name: 'mcp_x_delete', status: 'intercepted' },
    ]);

    expect(groups.map(group => [group.name, group.status, group.count, group.durationMs])).toEqual([
      ['canvas_read_node', 'succeeded', 2, 12],
      ['canvas_read_node', 'failed', 1, undefined],
      ['canvas_read_node', 'failed', 1, undefined],
      ['mcp_x_delete', 'intercepted', 1, undefined],
    ]);
  });
});

describe('Codemode tool row', () => {
  it('summarizes script calls and does not hide child failures behind a success', () => {
    render([codemodeTool({
      ok: true,
      output: [],
      calls: [call(1, 'canvas_search_nodes', 'succeeded'), call(2, 'canvas_read_node', 'failed', { error: 'missing' })],
    })]);

    expect(host?.textContent).toContain('Ran script · 2 calls, 1 failed');
  });

  it('shows the script, grouped calls, policy interceptions, output and errors when expanded', () => {
    render([codemodeTool({
      ok: false,
      output: ['partial'],
      error: 'Codemode timed out; completed calls were not undone',
      calls: [
        call(1, 'canvas_read_node', 'succeeded'),
        call(2, 'canvas_read_node', 'succeeded'),
        call(3, 'mcp_x_delete', 'intercepted'),
        call(4, 'canvas_read_node', 'cancelled'),
      ],
    }, 'failed')], new Set([1]));

    const text = host?.textContent ?? '';
    expect(text).toContain('Ran script · 4 calls');
    expect(text).toContain('canvas_search_nodes({})');
    expect(text).toContain('×2');
    expect(text).toContain('blocked by policy');
    expect(text).toContain('cancelled');
    expect(text).toContain('partial');
    expect(text).toContain('completed calls were not undone');
    // The generic raw JSON dump is replaced, not duplicated.
    expect(text).not.toContain('"parentToolCallId"');
    // The script source leads the details but stays folded.
    const firstSection = host?.querySelector('.chat-tool-call-result > .chat-tool-call-section');
    expect(firstSection?.tagName).toBe('DETAILS');
    expect(firstSection?.hasAttribute('open')).toBe(false);
  });
});
