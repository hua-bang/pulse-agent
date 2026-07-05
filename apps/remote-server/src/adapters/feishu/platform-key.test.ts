import { describe, expect, it } from 'vitest';

import { buildFeishuPlatformKey, parseFeishuPlatformKey, resolveFeishuTopicId } from './platform-key.js';

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
});
