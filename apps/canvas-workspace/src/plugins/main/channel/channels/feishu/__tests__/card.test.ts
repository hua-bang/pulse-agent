import { describe, it, expect } from 'vitest';
import {
  buildReplyCard,
  buildDoneCard,
  buildProgressCard,
  buildThinkingCard,
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

  it('formatToolLabel surfaces a readable detail for paths and urls', () => {
    // File paths collapse to their basename so the row stays compact.
    expect(formatToolLabel('read', { path: '/docs/space/AGENTS.MD' })).toBe('read — AGENTS.MD');
    // URLs collapse to host/…/slug instead of a long link.
    expect(formatToolLabel('read', { url: 'https://x.feishu.cn/docx/AbCdToken123' })).toBe(
      'read — x.feishu.cn/…/AbCdToken123',
    );
    // A doc token is better than nothing when no nicer field exists.
    expect(formatToolLabel('read', { docToken: 'doccnXyz' })).toBe('read — doccnXyz');
  });

  it('keeps Working as an expanded process disclosure with a live timeline', () => {
    const card = buildProgressCard('working', tools, 20) as {
      header?: unknown;
      body: { elements: Array<Record<string, unknown>> };
    };
    const panel = card.body.elements[0];
    const body = texts(card).join('\n');
    expect(card.header).toBeUndefined();
    expect(panel.tag).toBe('collapsible_panel');
    expect(panel.expanded).toBe(true);
    expect(body).toContain('**Working**');
    expect(body).toContain('<font color="grey">│</font>');
    expect(body).toContain('<font color="grey">›</font>');
    expect(body).toContain('<font color="grey">执行中</font>');
    expect(body).toContain('<font color="grey">Canvas read node · node-1 · 18s</font>');
    expect(body).toContain('Canvas write node · node-2');
    expect(body).toContain('working');
    expect(body).not.toContain('Called tools');
    expect(JSON.stringify(card)).not.toContain('"text_size":"heading"');
    expect(JSON.stringify(card)).toContain('"text_size":"normal"');
    expect(JSON.stringify(card)).toContain('"text_size":"notation"');
  });

  it('does not freeze the live answer after the old 700 character preview limit', () => {
    const streamed = `${'a'.repeat(760)}tail`;
    const body = texts(buildProgressCard(streamed)).join('\n');
    expect(body).toContain('tail');
  });

  it('thinking and progress cards keep the same stable status geometry', () => {
    const thinking = texts(buildThinkingCard());
    const progress = texts(buildProgressCard('', tools));
    expect(thinking[0]).toBe('**Working**');
    expect(progress[0]).toBe(thinking[0]);
  });

  it('replaces the pulsing dot with quiet pending text and delayed elapsed time', () => {
    expect(texts(buildThinkingCard())[1]).toBe('<font color="grey">正在处理</font>');
    for (const elapsed of [0, 1, 2, 3, 4]) {
      expect(texts(buildProgressCard('', [], elapsed))[1]).toBe(texts(buildThinkingCard())[1]);
    }
    expect(texts(buildProgressCard('', [], 5))[1]).toContain('正在处理 · 已等待 5 秒');
    expect(texts(buildProgressCard('', [], 65))[1]).toContain('已等待 1 分 05 秒');
    expect(texts(buildProgressCard('', [], -5))[1]).toContain('正在处理</font>');
    expect(texts(buildProgressCard('', [], NaN))[1]).toContain('正在处理</font>');
  });

  it('keeps active tool markers stable and removes pending copy on completion', () => {
    expect(texts(buildProgressCard('', tools, 1))).toEqual(texts(buildProgressCard('', tools, 2)));
    const done = texts(buildDoneCard('answer', tools)).join('\n');
    expect(done).not.toContain('执行中');
    expect(done).not.toContain('正在处理');
    expect(done).not.toContain('已等待');
  });

  it('done process card keeps commentary inside the completed timeline', () => {
    const card = buildDoneCard('final answer', tools) as {
      header?: unknown;
      body: { elements: Array<Record<string, unknown>> };
    };
    const panel = card.body.elements.find((e) => e.tag === 'collapsible_panel');
    expect(panel).toBeDefined();
    expect(panel!.expanded).toBe(true);
    expect(card.header).toBeUndefined();
    const body = texts(card).join('\n');
    expect(body).toContain('**Completed**');
    expect(body).toContain('final answer');
    expect(body).toContain('<font color="grey">│</font>');
    expect(body).toContain('<font color="grey">›</font>');
    expect(body).toContain('◎ Completed');
    expect(body).not.toContain('Called tools');
    expect(body).toContain('Canvas read node · node-1');
  });

  it('done process card retains its disclosure even without tools', () => {
    const card = buildDoneCard('hi', []) as {
      body: { elements: Array<Record<string, unknown>> };
    };
    expect(card.body.elements).toHaveLength(1);
    expect(card.body.elements[0].tag).toBe('collapsible_panel');
    expect(texts(card).join('\n')).toContain('hi');
  });

  it('reply owns the stop button while active and only the result after completion', () => {
    const active = JSON.stringify(buildReplyCard('', 'working', 'turn-token'));
    expect(active).toContain('run.stop'); expect(active).toContain('停止');
    expect(active).toContain('"disabled":false');
    expect(JSON.stringify(buildReplyCard('', 'queued', 'turn-token'))).toContain('"disabled":true');
    const done = JSON.stringify(buildReplyCard('最终回答', 'completed', 'turn-token'));
    expect(done).toContain('最终回答'); expect(done).not.toContain('button');
    expect(done).not.toContain('collapsible_panel');
  });

  it('bounds final reply text to the existing card limit while retaining the latest output', () => {
    const text = '长'.repeat(20000) + '最终结论';
    const reply = texts(buildReplyCard(text, 'completed')).join('');
    expect(reply.length).toBeLessThanOrEqual(8001);
    expect(reply.endsWith('最终结论')).toBe(true);
  });

  it('interleaves public commentary with tools in emission order', () => {
    const content = texts(buildProgressCard('现在整理结果', [
      { label: 'read', beforeText: '先读入口文件', done: true },
      { label: 'bash', beforeText: '接着检查仓库状态', done: false },
    ])).join('\n');
    expect(content.indexOf('先读入口文件')).toBeLessThan(content.indexOf('Read'));
    expect(content.indexOf('Read')).toBeLessThan(content.indexOf('接着检查仓库状态'));
    expect(content.indexOf('Bash')).toBeLessThan(content.indexOf('现在整理结果'));
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
