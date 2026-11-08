import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./client.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./client.js')>();
  return {
    ...actual,
    createLarkClient: vi.fn(() => ({})),
    sendCardMessage: vi.fn(async () => 'card-1'),
    updateCardMessage: vi.fn(async () => undefined),
    sendTextMessage: vi.fn(async () => 'text-1'),
    addMessageReaction: vi.fn(async () => undefined),
  };
});

const client = await import('./client.js');
const { FeishuAdapter } = await import('./adapter.js');

function lastUpdatedCardText(): string {
  const calls = vi.mocked(client.updateCardMessage).mock.calls;
  return JSON.stringify(calls.at(-1)?.[2]);
}

async function runToDone(result: string): Promise<void> {
  const adapter = new FeishuAdapter();
  const handle = await adapter.createStreamHandle({
    platformKey: 'feishu:ou_user',
    memoryKey: 'feishu:user:ou_user',
    text: 'hi',
  } as never, 'stream-1');
  await handle.onDone?.(result);
}

describe('Feishu run completion', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('puts the final answer into the run card and sends no separate message', async () => {
    await runToDone('final **answer**');

    expect(lastUpdatedCardText()).toContain('final **answer**');
    expect(lastUpdatedCardText()).not.toContain('下面是最终答复');
    expect(client.sendTextMessage).not.toHaveBeenCalled();
  });

  it('falls back to a separate text message when the answer is too long for a card', async () => {
    const longAnswer = 'x'.repeat(client.MAX_CARD_ANSWER_LENGTH + 1);
    await runToDone(longAnswer);

    expect(lastUpdatedCardText()).toContain('下面是最终答复');
    expect(client.sendTextMessage).toHaveBeenCalledWith(expect.anything(), 'ou_user', 'open_id', longAnswer, undefined);
  });

  it('falls back to a separate text message when the card update fails', async () => {
    vi.mocked(client.updateCardMessage).mockRejectedValueOnce(new Error('card too large'));
    await runToDone('short answer');

    expect(client.sendTextMessage).toHaveBeenCalledWith(expect.anything(), 'ou_user', 'open_id', 'short answer', undefined);
  });
});
