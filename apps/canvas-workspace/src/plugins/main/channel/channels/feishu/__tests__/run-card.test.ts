import type * as lark from '@larksuiteoapi/node-sdk';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FeishuRunCard } from '../run-card';
import { buildDoneCard, buildProgressCard, buildThinkingCard, formatStreamingToolLabel } from '../card';
import { sendCardMessage, updateCardMessage } from '../feishu-client';

vi.mock('../feishu-client', () => ({
  sendCardMessage: vi.fn(async () => 'message-1'),
  updateCardMessage: vi.fn(async () => undefined),
}));

function live(text = ''): object {
  return { schema: '2.0', config: {}, body: { elements: [{ tag: 'markdown', element_id: 'answer', content: text }] } };
}

function setup() {
  const create = vi.fn(async () => ({ code: 0, data: { card_id: 'card-1' } }));
  const content = vi.fn(async (_request: unknown) => ({ code: 0 }));
  const settings = vi.fn(async (_request: unknown) => ({ code: 0 }));
  const update = vi.fn(async (_request: unknown) => ({ code: 0 }));
  const client = { cardkit: { v1: { card: { create, settings, update }, cardElement: { content } } } };
  const target = { chatId: 'chat-1', isGroup: true, threadId: 'topic-1', triggerMessageId: 'trigger-1' };
  const card = new FeishuRunCard(client as unknown as lark.Client, target);
  return { card, create, content, settings, update, target };
}

afterEach(() => { vi.restoreAllMocks(); vi.clearAllMocks(); });

describe('native Feishu run card', () => {
  it('sends the entity to the original topic and streams full text into stable components', async () => {
    const { card, create, content, target } = setup();
    await card.open(live());
    expect(create).toHaveBeenCalledOnce();
    expect(sendCardMessage).toHaveBeenCalledWith(expect.anything(), target, {
      type: 'card', data: { card_id: 'card-1' },
    });
    await card.update(live('hello '), false);
    await card.update(live('hello world'), false);
    const requests = content.mock.calls.map(([request]) => request);
    expect(requests).toEqual([
      { path: { card_id: 'card-1', element_id: 'answer' }, data: { content: 'hello ', sequence: 1 } },
      { path: { card_id: 'card-1', element_id: 'answer' }, data: { content: 'hello world', sequence: 2 } },
    ]);
    expect(updateCardMessage).not.toHaveBeenCalled();
  });

  it('skips unchanged text and closes streaming before the final replacement', async () => {
    const { card, content, settings, update } = setup();
    await card.open(live());
    await card.update(live('answer'), false);
    await card.update(live('answer'), false);
    expect(content).toHaveBeenCalledOnce();
    await card.update(buildDoneCard('answer'), true);
    expect(settings).toHaveBeenCalledWith({
      path: { card_id: 'card-1' },
      data: { sequence: 2, settings: '{"config":{"streaming_mode":false}}' },
    });
    expect(update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ sequence: 3 }),
    }));
    expect(settings.mock.invocationCallOrder[0]).toBeLessThan(update.mock.invocationCallOrder[0]);
  });

  it('retries rejected text with a newer sequence, without claiming it was delivered', async () => {
    const { card, content } = setup();
    await card.open(live());
    content.mockResolvedValueOnce({ code: 200810 });
    await expect(card.update(live('answer'), false)).rejects.toThrow('200810');
    await card.update(live('answer'), false);
    expect(content).toHaveBeenLastCalledWith(expect.objectContaining({
      data: { content: 'answer', sequence: 2 },
    }));
  });

  it('falls back before sending if the app lacks CardKit permission', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { card, create } = setup();
    create.mockRejectedValueOnce(new Error('permission denied'));
    await card.open(live());
    expect(sendCardMessage).toHaveBeenCalledOnce();
    expect(sendCardMessage).toHaveBeenCalledWith(expect.anything(), expect.anything(), live());
    await card.update(buildDoneCard('answer'), true);
    expect(updateCardMessage).toHaveBeenCalledOnce();
  });

  it('does not send a duplicate when entity message sending fails', async () => {
    const { card } = setup();
    vi.mocked(sendCardMessage).mockRejectedValueOnce(new Error('send response lost'));
    await expect(card.open(live())).rejects.toThrow('send response lost');
    expect(sendCardMessage).toHaveBeenCalledOnce();
  });

  it('does not send a late card after creation has been abandoned', async () => {
    const { card, create } = setup();
    let resolve!: (value: { code: number; data: { card_id: string } }) => void;
    create.mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
    const pending = card.open(live());
    card.abandon();
    resolve({ code: 0, data: { card_id: 'late-card' } });
    await expect(pending).rejects.toThrow('abandoned');
    expect(sendCardMessage).not.toHaveBeenCalled();
  });

  it('does not resume a final replacement after that final operation also times out', async () => {
    const { card, settings, update } = setup();
    await card.open(live());
    card.abandon();
    let resolve!: (value: { code: number }) => void;
    settings.mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
    const final = card.update(buildDoneCard('answer'), true);
    card.abandon();
    resolve({ code: 0 });
    await expect(final).rejects.toThrow('abandoned');
    expect(update).not.toHaveBeenCalled();
  });

  it('does not issue the rest of a multi-element update after a timeout', async () => {
    const { card, content } = setup();
    await card.open(live());
    let resolve!: (value: { code: number }) => void;
    content.mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
    const pending = card.update({ schema: '2.0', config: {}, body: { elements: [
      { tag: 'markdown', element_id: 'answer', content: 'answer' },
      { tag: 'markdown', element_id: 'progress', content: 'progress' },
    ] } }, false);
    card.abandon();
    resolve({ code: 0 });
    await expect(pending).rejects.toThrow('abandoned');
    expect(content).toHaveBeenCalledOnce();
  });
});

describe('streamed tool previews', () => {
  it('shows partial commands and tolerates split JSON escapes', () => {
    expect(formatStreamingToolLabel('bash', '{"command":"git sta')).toBe('bash — git sta');
    expect(formatStreamingToolLabel('bash', '{"command":"git status"}')).toBe('bash — git status');
    expect(formatStreamingToolLabel('read', '{"path":"/tmp/中文')).toBe('read — 中文');
    expect(formatStreamingToolLabel('read', '{"path":"\\u4e')).toBeUndefined();
    expect(formatStreamingToolLabel('read', '{"secret":"hidden')).toBeUndefined();
  });
});
