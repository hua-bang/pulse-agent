import { describe, it, expect } from 'vitest';
import { parseInbound } from '../channels/feishu/feishu-channel';

interface EventOpts {
  messageId?: string;
  chatId?: string;
  chatType?: 'p2p' | 'group';
  text?: string;
  mentions?: unknown[];
  threadId?: string;
  rootId?: string;
  messageType?: string;
}

function event(opts: EventOpts): unknown {
  return {
    message: {
      message_id: opts.messageId ?? 'm1',
      chat_id: opts.chatId ?? 'chat1',
      chat_type: opts.chatType ?? 'p2p',
      message_type: opts.messageType ?? 'text',
      content: JSON.stringify({ text: opts.text ?? 'hi' }),
      mentions: opts.mentions,
      thread_id: opts.threadId,
      root_id: opts.rootId,
    },
    sender: { sender_id: { open_id: 'user1' } },
  };
}

// Narrow the opaque reply token for assertions.
function reply(out: ReturnType<typeof parseInbound>) {
  return out!.reply as {
    chatId: string;
    threadId?: string;
    isGroup: boolean;
    triggerMessageId: string;
  };
}

describe('parseInbound', () => {
  it('direct chat keys on chat_id', () => {
    const out = parseInbound(event({ chatType: 'p2p', chatId: 'dmA' }));
    expect(out).not.toBeNull();
    expect(out!.conversationId).toBe('dmA');
    expect(out!.isDirect).toBe(true);
    expect(reply(out).chatId).toBe('dmA');
    expect(reply(out).threadId).toBeUndefined();
  });

  it('different groups produce different conversation ids', () => {
    const a = parseInbound(event({ chatType: 'group', chatId: 'gA', mentions: [{}] }));
    const b = parseInbound(event({ chatType: 'group', chatId: 'gB', mentions: [{}] }));
    expect(a!.conversationId).toBe('gA');
    expect(b!.conversationId).toBe('gB');
    expect(a!.conversationId).not.toBe(b!.conversationId);
  });

  it('group message without @-mention is ignored', () => {
    const out = parseInbound(event({ chatType: 'group', chatId: 'gA', mentions: [] }));
    expect(out).toBeNull();
  });

  it('group @-mention strips the mention and marks isMention', () => {
    const out = parseInbound(
      event({ chatType: 'group', chatId: 'gA', mentions: [{}], text: '@bot do it' }),
    );
    expect(out).not.toBeNull();
    expect(out!.text).toBe('do it');
    expect(out!.isMention).toBe(true);
    expect(out!.isDirect).toBe(false);
  });

  it('topic group: each thread is its own conversation, replies route in-thread', () => {
    const t1 = parseInbound(
      event({ chatType: 'group', chatId: 'gT', threadId: 'th1', mentions: [{}], messageId: 'mA' }),
    );
    const t2 = parseInbound(
      event({ chatType: 'group', chatId: 'gT', threadId: 'th2', mentions: [{}], messageId: 'mB' }),
    );
    expect(t1!.conversationId).toBe('gT:th1');
    expect(t2!.conversationId).toBe('gT:th2');
    // Same group, different topics → distinct conversations.
    expect(t1!.conversationId).not.toBe(t2!.conversationId);
    // Reply routing carries thread + the triggering message for reply_in_thread.
    expect(reply(t1).threadId).toBe('th1');
    expect(reply(t1).triggerMessageId).toBe('mA');
    expect(reply(t1).isGroup).toBe(true);
  });

  it('direct chat reply routing is not a group (create path)', () => {
    const out = parseInbound(event({ chatType: 'p2p', chatId: 'dmA' }));
    expect(reply(out).isGroup).toBe(false);
  });

  it('falls back to root_id so a topic root and its replies stay one conversation', () => {
    // Topic root: no thread_id yet, but it is the thread root (root_id = its id).
    const root = parseInbound(
      event({ chatType: 'group', chatId: 'gT', rootId: 'rA', messageId: 'rA', mentions: [{}] }),
    );
    // A later reply in the same topic: carries thread_id == root_id.
    const followUp = parseInbound(
      event({ chatType: 'group', chatId: 'gT', threadId: 'rA', messageId: 'mC', mentions: [{}] }),
    );
    expect(root!.conversationId).toBe('gT:rA');
    expect(followUp!.conversationId).toBe('gT:rA');
    // Root and follow-up resolve to the SAME conversation → same session.
    expect(root!.conversationId).toBe(followUp!.conversationId);
  });

  it('a topic-group conversation differs from the same group’s non-topic id', () => {
    const topic = parseInbound(
      event({ chatType: 'group', chatId: 'gT', threadId: 'th1', mentions: [{}] }),
    );
    const plain = parseInbound(event({ chatType: 'group', chatId: 'gT', mentions: [{}] }));
    expect(topic!.conversationId).toBe('gT:th1');
    expect(plain!.conversationId).toBe('gT');
  });

  it('non-text messages are ignored', () => {
    const out = parseInbound(event({ messageType: 'image' }));
    expect(out).toBeNull();
  });
});
