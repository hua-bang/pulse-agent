import { describe, it, expect } from 'vitest';
import {
  buildDoneCard,
  buildProgressCard,
  buildWorkspacePickerCard,
  formatToolLabel,
  type ToolEntry,
} from '../card';

/** Pull every markdown content string out of a card, panels included. */
function texts(card: object): string[] {
  const out: string[] = [];
  const walk = (node: unknown): void => {
    if (!node || typeof node !== 'object') return;
    const n = node as Record<string, unknown>;
    if (n.tag === 'markdown' && typeof n.content === 'string') out.push(n.content);
    for (const v of Object.values(n)) {
      if (Array.isArray(v)) v.forEach(walk);
      else if (v && typeof v === 'object') walk(v);
    }
  };
  walk(card);
  return out;
}

describe('feishu card tool list', () => {
  const tools: ToolEntry[] = [
    { label: 'canvas_read_node — node-1', done: true, elapsedSec: 18 },
    { label: 'canvas_write_node — node-2', done: false },
  ];

  it('formatToolLabel joins name and a detail, without a status icon', () => {
    expect(formatToolLabel('canvas_read_node', { nodeId: 'node-1' })).toBe(
      'canvas_read_node — node-1',
    );
    expect(formatToolLabel('think', {})).toBe('think');
  });

  it('progress card lists every tool with running/done status', () => {
    const body = texts(buildProgressCard('working', tools, 20)).join('\n');
    expect(body).toContain('✅ canvas_read_node — node-1 · 18s');
    expect(body).toContain('⏳ canvas_write_node — node-2');
    expect(body).toContain('⏱️ 20s');
  });

  it('done card folds the tool list into a collapsible panel', () => {
    const card = buildDoneCard('the answer', tools) as {
      body: { elements: Array<Record<string, unknown>> };
    };
    const panel = card.body.elements.find((e) => e.tag === 'collapsible_panel');
    expect(panel).toBeDefined();
    expect(panel!.expanded).toBe(false);
    const body = texts(card).join('\n');
    expect(body).toContain('the answer');
    expect(body).toContain('🛠️ 2 tool calls');
    expect(body).toContain('canvas_read_node — node-1');
  });

  it('done card with no tools is just the answer (no panel)', () => {
    const card = buildDoneCard('hi', []) as {
      body: { elements: Array<Record<string, unknown>> };
    };
    expect(card.body.elements).toHaveLength(1);
    expect(card.body.elements[0].tag).toBe('markdown');
  });

  it('workspace picker card uses a workspace dropdown and two submit buttons', () => {
    const card = buildWorkspacePickerCard(
      {
        title: 'Choose a workspace',
        summary: 'Current chat: not connected.',
        defaultCarry: false,
        fallbackText: 'fallback',
        options: [
          { id: 'ws-A', label: 'Alpha (ws-A)', isActive: true, isBound: false },
          { id: 'ws-B', label: 'Beta (ws-B)', isActive: false, isBound: true },
        ],
      },
      {
        conversationId: 'convA',
        reply: { chatId: 'chatA', isGroup: false, triggerMessageId: 'm1' },
      },
    ) as {
      header: { title: { content: string } };
      body: { elements: Array<Record<string, unknown>> };
    };

    const body = texts(card).join('\n');
    expect(card.header.title.content).toBe('Choose a workspace');
    expect(body).toContain('Current chat: not connected.');

    const form = card.body.elements.find((e) => e.tag === 'form') as {
      elements: Array<Record<string, unknown>>;
    };
    expect(form).toBeDefined();
    const select = form.elements.find((e) => e.tag === 'select_static') as {
      name: string;
      initial_option: string;
      options: Array<{ text: { content: string }; value: string }>;
    };
    expect(select.name).toBe('workspace_picker_workspace');
    expect(select.initial_option).toBe('ws-B');
    expect(select.options).toEqual([
      { text: { tag: 'plain_text', content: 'Alpha (ws-A) 🖥️' }, value: 'ws-A' },
      { text: { tag: 'plain_text', content: 'Beta (ws-B) ⭐' }, value: 'ws-B' },
    ]);

    const buttons: Array<Record<string, unknown>> = [];
    const collectButtons = (node: unknown): void => {
      if (!node || typeof node !== 'object') return;
      const record = node as Record<string, unknown>;
      if (record.tag === 'button') buttons.push(record);
      for (const value of Object.values(record)) {
        if (Array.isArray(value)) value.forEach(collectButtons);
        else collectButtons(value);
      }
    };
    collectButtons(form);
    expect(buttons).toHaveLength(2);
    expect(buttons[0].name).toBe('workspace_use');
    expect(buttons[0].value).toEqual({
      action: 'workspace.use',
      carry: false,
      conversationId: 'convA',
      reply: { chatId: 'chatA', isGroup: false, triggerMessageId: 'm1' },
    });
    expect(buttons[0].behaviors).toEqual([{ type: 'callback', value: buttons[0].value }]);
    expect(buttons[1].name).toBe('workspace_use_carry');
    expect(buttons[1].value).toEqual({
      action: 'workspace.use',
      carry: true,
      conversationId: 'convA',
      reply: { chatId: 'chatA', isGroup: false, triggerMessageId: 'm1' },
    });
    expect(buttons[1].behaviors).toEqual([{ type: 'callback', value: buttons[1].value }]);
  });
});
