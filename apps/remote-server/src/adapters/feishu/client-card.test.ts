import { describe, expect, it } from 'vitest';

import { buildCompletedProcessCard, buildFinalAnswerCard, buildProgressCard } from './client.js';

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

  it('progress card uses a compact native-like process row with collapsible details', () => {
    const card = buildProgressCard(context);
    const body = texts(card).join('\n');

    expect(body).toContain('启动 Agent · 运行中 · Called tools 1 time · 3s');
    expect(body).toContain('**当前步骤**');
    expect(body).toContain('read — AGENTS.md');
    expect(body).toContain('**当前答复**');
    expect(elements(card).some((item) => item.tag === 'collapsible_panel')).toBe(true);
  });

  it('completed process card folds into the Agent process row and points to the answer card', () => {
    const card = buildCompletedProcessCard(context, ['read — AGENTS.md']);
    const body = texts(card).join('\n');

    expect(body).toContain('启动 Agent · 已完成 · Called tools 1 time · 3s');
    expect(body).toContain('已完成 1 个步骤，最终答复见下一条消息。');
    expect(body).toContain('**执行步骤**');
    expect(elements(card).some((item) => item.tag === 'collapsible_panel')).toBe(true);
  });

  it('final answer card only contains the user-facing answer', () => {
    const card = buildFinalAnswerCard('最终结论');
    const body = texts(card).join('\n');

    expect(body).toContain('最终结论');
    expect(body).not.toContain('run-123');
    expect(elements(card).some((item) => item.tag === 'collapsible_panel')).toBe(false);
  });
});
