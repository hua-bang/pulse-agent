import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FeishuStream } from '../feishu-channel';
import {
  sendCardMessage,
  sendTextMessage,
  updateCardMessage,
} from '../feishu-client';

vi.mock('../feishu-client', () => ({
  createLarkClient: vi.fn(),
  feishuConfigured: vi.fn(() => true),
  sendCardMessage: vi.fn(async () => 'card-msg'),
  sendImageMessage: vi.fn(async () => 'image-msg'),
  sendTextMessage: vi.fn(async () => 'text-msg'),
  updateCardMessage: vi.fn(async () => undefined),
}));

const mockedSendCard = vi.mocked(sendCardMessage);
const mockedSendText = vi.mocked(sendTextMessage);
const mockedUpdateCard = vi.mocked(updateCardMessage);

async function flushAsync(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe('FeishuStream', () => {
  let consoleErrorSpy: { mockRestore(): void };

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockedSendCard.mockResolvedValue('card-msg');
    mockedSendText.mockResolvedValue('text-msg');
    mockedUpdateCard.mockResolvedValue(undefined);
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
    vi.useRealTimers();
  });

  it('keeps streaming after a transient card patch failure', async () => {
    mockedUpdateCard
      .mockRejectedValueOnce(new Error('rate limited'))
      .mockResolvedValue(undefined);
    const stream = new FeishuStream({} as never, {
      chatId: 'group1',
      isGroup: true,
      triggerMessageId: 'm1',
    });

    await stream.init();
    stream.onText('first chunk');
    await vi.advanceTimersByTimeAsync(800);
    await flushAsync();

    stream.onText(' second chunk');
    await vi.advanceTimersByTimeAsync(800);
    await flushAsync();

    expect(mockedUpdateCard).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(mockedUpdateCard.mock.calls[1][2])).toContain('second chunk');
    expect(mockedSendText).not.toHaveBeenCalled();
  });

  it('falls back when a card patch hangs', async () => {
    mockedUpdateCard.mockImplementationOnce(() => new Promise(() => undefined));
    const stream = new FeishuStream({} as never, {
      chatId: 'group1',
      isGroup: true,
      triggerMessageId: 'm1',
    });

    await stream.init();
    const done = stream.onDone('final answer');
    await vi.advanceTimersByTimeAsync(10_000);
    await done;

    expect(mockedSendText).toHaveBeenCalledWith(
      expect.anything(),
      { chatId: 'group1', isGroup: true, triggerMessageId: 'm1' },
      'final answer',
    );
  });

  it('sends final text fallback when the final card update fails', async () => {
    mockedUpdateCard.mockRejectedValueOnce(new Error('final failed'));
    const stream = new FeishuStream({} as never, {
      chatId: 'group1',
      isGroup: true,
      triggerMessageId: 'm1',
    });

    await stream.init();
    await stream.onDone('final answer');

    expect(mockedUpdateCard).toHaveBeenCalledTimes(1);
    expect(mockedSendText).toHaveBeenCalledWith(
      expect.anything(),
      { chatId: 'group1', isGroup: true, triggerMessageId: 'm1' },
      'final answer',
    );
  });
});
