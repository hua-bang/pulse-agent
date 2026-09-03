import { describe, expect, it, vi } from 'vitest';
import type { ChatImageAttachment } from '../../../../../types';
import { submitQuickAction } from '../submitQuickAction';

const attachment: ChatImageAttachment = {
  id: 'ready-image',
  path: '/tmp/ready.png',
  fileName: 'ready.png',
  status: 'ready',
};

describe('submitQuickAction', () => {
  it('forwards ready attachments and clears the draft only after acknowledgement', async () => {
    const sendMessage = vi.fn(async () => true);
    const clearInput = vi.fn();

    await expect(submitQuickAction({
      prompt: 'Summarize this',
      quickAction: 'summarize',
      requestContext: { executionMode: 'ask' },
      attachments: [attachment],
      sendMessage,
      clearInput,
    })).resolves.toBe(true);

    expect(sendMessage).toHaveBeenCalledWith(
      'Summarize this',
      { executionMode: 'ask', quickAction: 'summarize' },
      [attachment],
    );
    expect(clearInput).toHaveBeenCalledOnce();
  });

  it('keeps the draft when main rejects the send', async () => {
    const clearInput = vi.fn();
    await submitQuickAction({
      prompt: 'Summarize this',
      attachments: [attachment],
      sendMessage: vi.fn(async () => false),
      clearInput,
    });
    expect(clearInput).not.toHaveBeenCalled();
  });
});
