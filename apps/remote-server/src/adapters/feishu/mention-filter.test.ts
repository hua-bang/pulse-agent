import { describe, expect, it } from 'vitest';

import { isFeishuMessageMentioningBot } from './mention-filter.js';

describe('isFeishuMessageMentioningBot', () => {
  it('matches a bot open_id nested under the mention id object', () => {
    expect(isFeishuMessageMentioningBot([
      {
        key: '@_user_1',
        id: {
          open_id: 'ou_bot',
          user_id: 'bot_user',
        },
        name: 'Pulse Coder',
      },
    ], {
      openId: 'ou_bot',
    })).toBe(true);
  });

  it('ignores group messages that mention another user', () => {
    expect(isFeishuMessageMentioningBot([
      {
        key: '@_user_2',
        id: {
          open_id: 'ou_someone_else',
          user_id: 'other_user',
        },
        name: 'Someone Else',
      },
    ], {
      openId: 'ou_bot',
      userId: 'bot_user',
    })).toBe(false);
  });

  it('matches configured bot mention aliases by name', () => {
    expect(isFeishuMessageMentioningBot([
      {
        key: '@Pulse',
        name: '@Pulse',
      },
    ], {
      aliases: ['pulse'],
    })).toBe(true);
  });

  it('does not accept mentions when no bot identity is available', () => {
    expect(isFeishuMessageMentioningBot([
      {
        key: '@_user_1',
        name: 'Any Mention',
      },
    ], {})).toBe(false);
  });
});
