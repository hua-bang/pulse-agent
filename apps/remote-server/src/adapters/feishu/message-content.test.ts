import { describe, expect, it } from 'vitest';

import { parseFeishuMessageContent } from './message-content.js';

describe('parseFeishuMessageContent', () => {
  it('parses direct image messages as attachments', () => {
    const parsed = parseFeishuMessageContent('image', JSON.stringify({ image_key: 'img_v3_key' }), 'om_message');

    expect(parsed).toEqual({
      text: '',
      attachments: [
        {
          id: 'img_v3_key',
          url: 'feishu://image/img_v3_key',
          name: 'img_v3_key.jpg',
          mimeType: 'image/jpeg',
          source: 'feishu',
          messageId: 'om_message',
        },
      ],
    });
  });

  it('parses post messages with text and image elements', () => {
    const parsed = parseFeishuMessageContent('post', JSON.stringify({
      content: [
        [
          { tag: 'text', text: 'please inspect' },
          { tag: 'img', image_key: 'img_post_key' },
        ],
      ],
    }), 'om_post');

    expect(parsed?.text).toBe('please inspect');
    expect(parsed?.attachments).toEqual([
      {
        id: 'img_post_key',
        url: 'feishu://image/img_post_key',
        name: 'img_post_key.jpg',
        mimeType: 'image/jpeg',
        source: 'feishu',
        messageId: 'om_post',
      },
    ]);
  });

  it('deduplicates repeated post image elements', () => {
    const parsed = parseFeishuMessageContent('post', JSON.stringify({
      content: [
        [
          { tag: 'img', image_key: 'img_same_key' },
          { tag: 'img', image_key: 'img_same_key' },
        ],
      ],
    }), 'om_post');

    expect(parsed?.attachments).toHaveLength(1);
    expect(parsed?.attachments?.[0]?.id).toBe('img_same_key');
  });

  it('parses localized post message payloads', () => {
    const parsed = parseFeishuMessageContent('post', JSON.stringify({
      zh_cn: {
        title: 'title text',
        content: [
          [
            { tag: 'text', text: 'localized text' },
            { tag: 'img', image_key: 'img_locale_key' },
          ],
        ],
      },
    }), 'om_locale');

    expect(parsed?.text).toBe('title text localized text');
    expect(parsed?.attachments?.[0]?.id).toBe('img_locale_key');
  });

  it('ignores unsupported message types', () => {
    expect(parseFeishuMessageContent('audio', JSON.stringify({ file_key: 'file' }), 'om_message')).toBeNull();
  });
});
