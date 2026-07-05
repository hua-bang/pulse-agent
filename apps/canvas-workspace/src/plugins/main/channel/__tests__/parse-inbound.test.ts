import { describe, it, expect } from 'vitest';
import { parseCardAction, parseInbound } from '../channels/feishu/feishu-channel';

interface EventOpts {
  messageId?: string;
  chatId?: string;
  chatType?: 'p2p' | 'group' | 'topic_group';
  text?: string;
  content?: unknown;
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
      content: JSON.stringify(opts.content ?? { text: opts.text ?? 'hi' }),
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

const BOT = {
  appId: 'cli_bot',
  openId: 'ou_bot',
  userId: 'bot_user',
  unionId: 'on_bot',
  name: 'Pulse',
};

const BOT_MENTION = { key: '@_user_bot', id: { open_id: 'ou_bot' }, name: 'Pulse' };
const OTHER_MENTION = { key: '@_user_other', id: { open_id: 'ou_other' }, name: 'Pulse' };

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
    const a = parseInbound(event({ chatType: 'group', chatId: 'gA', mentions: [BOT_MENTION] }), BOT);
    const b = parseInbound(event({ chatType: 'group', chatId: 'gB', mentions: [BOT_MENTION] }), BOT);
    expect(a!.conversationId).toBe('gA');
    expect(b!.conversationId).toBe('gB');
    expect(a!.conversationId).not.toBe(b!.conversationId);
  });

  it('group message without @-mention is ignored', () => {
    const out = parseInbound(event({ chatType: 'group', chatId: 'gA', mentions: [] }));
    expect(out).toBeNull();
  });

  it('group message mentioning another user with the bot display name is ignored', () => {
    const out = parseInbound(
      event({ chatType: 'group', chatId: 'gA', mentions: [OTHER_MENTION], text: '@someone do it' }),
      BOT,
    );
    expect(out).toBeNull();
  });

  it('group @-mention strips the mention and marks isMention', () => {
    const out = parseInbound(
      event({ chatType: 'group', chatId: 'gA', mentions: [BOT_MENTION], text: '@bot do it' }),
      BOT,
    );
    expect(out).not.toBeNull();
    expect(out!.text).toBe('do it');
    expect(out!.isMention).toBe(true);
    expect(out!.isDirect).toBe(false);
  });

  it('group text with only a bare @word (no at-tag, no mentions) is ignored', () => {
    // A user typing "@someone" literally is not a structured bot mention, so
    // the bot must stay silent rather than treating any @-text as a ping.
    const out = parseInbound(
      event({ chatType: 'group', chatId: 'gA', mentions: undefined, text: '@bot 晚上好' }),
    );
    expect(out).toBeNull();
  });

  it('topic group text with an at tag is accepted even when mentions are omitted', () => {
    const out = parseInbound(
      event({
        chatType: 'topic_group',
        chatId: 'gT',
        threadId: 'th1',
        mentions: undefined,
        text: '<at user_id="bot_user">Pulse</at> 晚上好',
      }),
      BOT,
    );
    expect(out).not.toBeNull();
    expect(out!.conversationId).toBe('gT:th1');
    expect(out!.text).toBe('晚上好');
  });

  it('topic group text with another user at tag using the bot display name is ignored when mentions are omitted', () => {
    const out = parseInbound(
      event({
        chatType: 'topic_group',
        chatId: 'gT',
        threadId: 'th1',
        mentions: undefined,
        text: '<at user_id="other_user">Pulse</at> 晚上好',
      }),
      BOT,
    );
    expect(out).toBeNull();
  });

  it('topic group post messages are accepted and flattened', () => {
    const out = parseInbound(
      event({
        chatType: 'topic_group',
        chatId: 'gT',
        threadId: 'th1',
        messageType: 'post',
        mentions: [BOT_MENTION],
        content: {
          title: '晚上好',
          content: [
            [
              { tag: 'at', user_name: 'Pulse', user_id: 'bot' },
              { tag: 'text', text: ' 晚上好' },
            ],
          ],
        },
      }),
      BOT,
    );
    expect(out).not.toBeNull();
    expect(out!.conversationId).toBe('gT:th1');
    expect(out!.text).toBe('晚上好');
    expect(out!.isDirect).toBe(false);
  });

  it('topic group: each thread is its own conversation, replies route in-thread', () => {
    const t1 = parseInbound(
      event({ chatType: 'group', chatId: 'gT', threadId: 'th1', mentions: [BOT_MENTION], messageId: 'mA' }),
      BOT,
    );
    const t2 = parseInbound(
      event({ chatType: 'group', chatId: 'gT', threadId: 'th2', mentions: [BOT_MENTION], messageId: 'mB' }),
      BOT,
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
      event({ chatType: 'group', chatId: 'gT', rootId: 'rA', messageId: 'rA', mentions: [BOT_MENTION] }),
      BOT,
    );
    // A later reply in the same topic: carries thread_id == root_id.
    const followUp = parseInbound(
      event({ chatType: 'group', chatId: 'gT', threadId: 'rA', messageId: 'mC', mentions: [BOT_MENTION] }),
      BOT,
    );
    expect(root!.conversationId).toBe('gT:rA');
    expect(followUp!.conversationId).toBe('gT:rA');
    // Root and follow-up resolve to the SAME conversation → same session.
    expect(root!.conversationId).toBe(followUp!.conversationId);
  });

  it('a topic-group conversation differs from the same group’s non-topic id', () => {
    const topic = parseInbound(
      event({ chatType: 'group', chatId: 'gT', threadId: 'th1', mentions: [BOT_MENTION] }),
      BOT,
    );
    const plain = parseInbound(event({ chatType: 'group', chatId: 'gT', mentions: [BOT_MENTION] }), BOT);
    expect(topic!.conversationId).toBe('gT:th1');
    expect(plain!.conversationId).toBe('gT');
  });

  it('direct image message is accepted with empty text (carries the image)', () => {
    const out = parseInbound(event({ messageType: 'image', content: { image_key: 'img_x' } }));
    expect(out).not.toBeNull();
    expect(out!.text).toBe('');
    expect(out!.isDirect).toBe(true);
    expect(out!.conversationId).toBe('chat1');
  });

  it('image message without an image_key is ignored', () => {
    const out = parseInbound(event({ messageType: 'image', content: {} }));
    expect(out).toBeNull();
  });

  it('group image-only message without an @-mention is ignored', () => {
    const out = parseInbound(
      event({
        chatType: 'group',
        chatId: 'gA',
        messageType: 'image',
        content: { image_key: 'img_x' },
        mentions: [],
      }),
    );
    expect(out).toBeNull();
  });

  it('post message with an embedded image keeps its text and is accepted', () => {
    const out = parseInbound(
      event({
        chatType: 'p2p',
        messageType: 'post',
        content: {
          title: '',
          content: [[{ tag: 'text', text: 'look at this' }, { tag: 'img', image_key: 'img_p' }]],
        },
      }),
    );
    expect(out).not.toBeNull();
    expect(out!.text).toBe('look at this');
  });

  it('truly unsupported message types (audio) are ignored', () => {
    const out = parseInbound(event({ messageType: 'audio', content: {} }));
    expect(out).toBeNull();
  });
});

describe('parseCardAction', () => {
  it('turns a workspace picker button into an internal /use command', () => {
    const out = parseCardAction({
      open_id: 'user-card',
      open_message_id: 'card-msg',
      action: {
        value: {
          action: 'workspace.use',
          workspaceId: 'ws-A',
          carry: true,
          conversationId: 'chat1',
          reply: {
            chatId: 'chat1',
            isGroup: false,
            triggerMessageId: 'm1',
          },
        },
      },
    });

    expect(out).not.toBeNull();
    expect(out!.conversationId).toBe('chat1');
    expect(out!.userId).toBe('user-card');
    expect(out!.messageId).toBe('card:card-msg:user-card:chat1:ws-A:carry');
    expect(out!.text).toBe('/use ws-A --carry');
    expect(out!.isDirect).toBe(true);
  });

  it('keeps group routing when a group picker button is clicked', () => {
    const out = parseCardAction({
      action: {
        value: {
          action: 'workspace.use',
          workspaceId: 'ws-A',
          conversationId: 'group1:thread1',
          reply: {
            chatId: 'group1',
            threadId: 'thread1',
            isGroup: true,
            triggerMessageId: 'm1',
          },
        },
      },
    });

    expect(out).not.toBeNull();
    expect(out!.text).toBe('/use ws-A');
    expect(out!.isDirect).toBe(false);
    expect(out!.isMention).toBe(true);
    expect(out!.reply).toEqual({
      chatId: 'group1',
      threadId: 'thread1',
      isGroup: true,
      triggerMessageId: 'm1',
    });
  });

  it('reads the selected workspace from form_value for dropdown picker cards', () => {
    const out = parseCardAction({
      open_id: 'user-card',
      open_message_id: 'card-msg',
      action: {
        value: {
          action: 'workspace.use',
          carry: true,
          conversationId: 'chat1',
          reply: {
            chatId: 'chat1',
            isGroup: false,
            triggerMessageId: 'm1',
          },
        },
        form_value: {
          workspace_picker_workspace: 'ws-B',
        },
      },
    });

    expect(out).not.toBeNull();
    expect(out!.messageId).toBe('card:card-msg:user-card:chat1:ws-B:carry');
    expect(out!.text).toBe('/use ws-B --carry');
  });

  it('handles nested Feishu card action events with behavior callback values', () => {
    const out = parseCardAction({
      event: {
        operator: {
          open_id: 'operator-open',
        },
        context: {
          open_message_id: 'card-msg',
        },
        action: {
          behaviors: [
            {
              value: {
                action: 'workspace.use',
                carry: false,
                conversationId: 'group1:thread1',
                reply: {
                  chatId: 'group1',
                  threadId: 'thread1',
                  isGroup: true,
                  triggerMessageId: 'm1',
                },
              },
            },
          ],
          form_value: {
            workspace_picker_workspace: 'ws-B',
          },
        },
      },
    });

    expect(out).not.toBeNull();
    expect(out!.userId).toBe('operator-open');
    expect(out!.messageId).toBe('card:card-msg:operator-open:group1:thread1:ws-B:use');
    expect(out!.text).toBe('/use ws-B');
    expect(out!.isDirect).toBe(false);
  });

  it('ignores malformed or unrelated card actions', () => {
    expect(parseCardAction({ action: { value: { action: 'other' } } })).toBeNull();
    expect(parseCardAction({ action: { value: { action: 'workspace.use' } } })).toBeNull();
  });
});
