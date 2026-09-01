import { describe, expect, it } from 'vitest';

import { buildCompletedProcessCard, buildProgressCard } from './client.js';

function texts(card: object): string[] {
  const out: string[] = [];
  const walk = (node: unknown): void => {
    if (!node || typeof node !== 'object') return;
    const record = node as Record<string, unknown>;
    if (record.tag === 'markdown' && typeof record.content === 'string') out.push(record.content);
    for (const value of Object.values(record)) {
      if (Array.isArray(value)) value.forEach(walk);
      else walk(value);
    }
  };
  walk(card);
  return out;
}

function elements(card: object): Array<Record<string, unknown>> {
  return (card as { body: { elements: Array<Record<string, unknown>> } }).body.elements;
}

describe('Feishu run cards', () => {
  const context = {
    platformKey: 'feishu:group:g1',
    memoryKey: 'feishu:user:u1',
    streamId: 'm1',
    runId: 'run-123',
    prompt: '帮我检查逻辑',
    elapsed: '3s',
    latestToolHint: 'read — AGENTS.md',
    detailText: 'partial answer',
    toolCalls: ['read — AGENTS.md'],
  };

  it('progress card shows the current stage and folds tool details', () => {
    const card = buildProgressCard(context) as { header?: unknown };
    const body = texts(card).join('\n');

    expect(card.header).toBeUndefined();
    expect(body).toContain('**Read AGENTS.md**');
    expect(body).toContain('运行中 · 3s');
    expect(body).toContain('partial answer');
    expect(body).toContain('Called tools 1 time');
    expect(body).not.toContain('**当前答复**');
    expect(body).not.toContain('run-123');
    expect(JSON.stringify(card)).not.toContain('"tag":"button"');
    expect(elements(card).some((item) => item.tag === 'collapsible_panel')).toBe(true);
  });

  it('completed process card leaves only a completion row plus folded tool details', () => {
    const card = buildCompletedProcessCard(context, ['read — AGENTS.md']) as { header?: unknown };
    const body = texts(card).join('\n');

    expect(card.header).toBeUndefined();
    expect(body).toContain('**Completed**');
    expect(body).toContain('已完成 1 个步骤，下面是最终答复。');
    expect(body).toContain('Called tools 1 time');
    expect(body).not.toContain('执行过程 · 已完成');
    expect(JSON.stringify(card)).not.toContain('"tag":"button"');
    expect(elements(card).some((item) => item.tag === 'collapsible_panel')).toBe(true);
  });
});
