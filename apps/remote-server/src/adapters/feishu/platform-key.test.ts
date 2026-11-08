import { describe, expect, it } from 'vitest';

import {
  buildFeishuPlatformKey,
  isFeishuGroupReplyInThread,
  isFeishuGroupSharedContext,
  parseFeishuPlatformKey,
  resolveFeishuSharedTopicId,
  resolveFeishuThreadRootTopicId,
  resolveFeishuTopicId,
} from './platform-key.js';

describe('Feishu platform keys', () => {
  it('scopes group platform keys by topic when available', () => {
    const platformKey = buildFeishuPlatformKey({
      chatId: 'oc_group',
      chatType: 'group',
      openId: 'ou_user',
      topicId: 'om_root',
    });

    expect(platformKey).toBe('feishu:group:oc_group:topic:om_root:user:ou_user');
    expect(parseFeishuPlatformKey(platformKey)).toEqual({
      kind: 'group',
      chatId: 'oc_group',
      topicId: 'om_root',
      openId: 'ou_user',
    });
  });

  it('uses the top-level message id as the topic fallback', () => {
    expect(resolveFeishuTopicId({
      message_id: 'om_first_prompt',
    })).toBe('om_first_prompt');
  });

  it('prefers Feishu thread ids over root or parent message ids', () => {
    expect(resolveFeishuTopicId({
      message_id: 'om_reply',
      thread_id: 'omt_topic',
      root_id: 'om_root_prompt',
      parent_id: 'om_parent_reply',
    })).toBe('omt_topic');
  });

  it('keeps classic replies scoped to their root topic', () => {
    expect(resolveFeishuTopicId({
      message_id: 'om_reply',
      root_id: 'om_root_prompt',
      parent_id: 'om_parent_reply',
    })).toBe('om_root_prompt');
  });

  it('sanitizes topic delimiters before embedding them in platform keys', () => {
    expect(buildFeishuPlatformKey({
      chatId: 'oc_group',
      chatType: 'group',
      openId: 'ou_user',
      topicId: 'om:root',
    })).toBe('feishu:group:oc_group:topic:om_root:user:ou_user');
  });

  it('builds shared group keys without a user segment, per topic or per group', () => {
    const topicKey = buildFeishuPlatformKey({
      chatId: 'oc_group', chatType: 'group', openId: 'ou_a', topicId: 'omt_topic', shared: true,
    });
    const groupKey = buildFeishuPlatformKey({ chatId: 'oc_group', chatType: 'group', openId: 'ou_b', shared: true });

    expect(topicKey).toBe('feishu:group:oc_group:topic:omt_topic');
    expect(groupKey).toBe('feishu:group:oc_group');
    expect(parseFeishuPlatformKey(topicKey)).toEqual({ kind: 'group', chatId: 'oc_group', topicId: 'omt_topic' });
    expect(parseFeishuPlatformKey(groupKey)).toEqual({ kind: 'group', chatId: 'oc_group' });
    // Direct messages are never shared.
    expect(buildFeishuPlatformKey({ chatType: 'p2p', openId: 'ou_a', shared: true })).toBe('feishu:ou_a');
  });

  it('still parses per-user and legacy group keys', () => {
    expect(parseFeishuPlatformKey('feishu:group:oc_group:user:ou_a')).toEqual({ kind: 'group', chatId: 'oc_group', openId: 'ou_a' });
    expect(parseFeishuPlatformKey('feishu:group:oc_group:ou_a')).toEqual({ kind: 'group', chatId: 'oc_group', openId: 'ou_a' });
  });

  it('uses only real topics (thread_id) for shared context', () => {
    expect(resolveFeishuSharedTopicId({ message_id: 'om_top' })).toBeUndefined();
    expect(resolveFeishuSharedTopicId({ message_id: 'om_reply', root_id: 'om_top', parent_id: 'om_top' })).toBeUndefined();
    expect(resolveFeishuSharedTopicId({ message_id: 'om_reply', thread_id: 'omt_topic' })).toBe('omt_topic');
  });

  it('reads FEISHU_GROUP_SHARED_CONTEXT', () => {
    expect(isFeishuGroupSharedContext({})).toBe(false);
    expect(isFeishuGroupSharedContext({ FEISHU_GROUP_SHARED_CONTEXT: 'true' })).toBe(true);
    expect(isFeishuGroupSharedContext({ FEISHU_GROUP_SHARED_CONTEXT: 'off' })).toBe(false);
  });

  it('keys reply-in-thread topics by the topic root, so the first question and follow-ups match', () => {
    const first = resolveFeishuThreadRootTopicId({ message_id: 'om_q' });
    const followUp = resolveFeishuThreadRootTopicId({
      message_id: 'om_follow', thread_id: 'omt_new', root_id: 'om_q', parent_id: 'om_bot',
    });
    expect(first).toBe('om_q');
    expect(followUp).toBe('om_q');
  });

  it('reads FEISHU_GROUP_REPLY_IN_THREAD', () => {
    expect(isFeishuGroupReplyInThread({})).toBe(false);
    expect(isFeishuGroupReplyInThread({ FEISHU_GROUP_REPLY_IN_THREAD: 'true' })).toBe(true);
  });
});
