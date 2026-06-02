import { describe, it, expect } from 'vitest';
import {
  buildDoneCard,
  buildProgressCard,
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
});
