import { describe, it, expect } from 'vitest';
import { collectImageKeys, extractInboundImageKeys } from '../inbound-image';

function event(messageType: string, content: unknown): unknown {
  return { message: { message_type: messageType, content: JSON.stringify(content) } };
}

describe('collectImageKeys', () => {
  it('reads the image_key from an image message', () => {
    expect(collectImageKeys(JSON.stringify({ image_key: 'img_a' }), 'image')).toEqual(['img_a']);
  });

  it('returns nothing for an image message missing the key', () => {
    expect(collectImageKeys(JSON.stringify({}), 'image')).toEqual([]);
  });

  it('walks a post body and collects every img element key (in order)', () => {
    const post = {
      title: 't',
      content: [
        [{ tag: 'text', text: 'a' }, { tag: 'img', image_key: 'img_1' }],
        [{ tag: 'img', image_key: 'img_2' }],
      ],
    };
    expect(collectImageKeys(JSON.stringify(post), 'post')).toEqual(['img_1', 'img_2']);
  });

  it('ignores text messages and malformed JSON', () => {
    expect(collectImageKeys(JSON.stringify({ text: 'hi' }), 'text')).toEqual([]);
    expect(collectImageKeys('not json', 'image')).toEqual([]);
    expect(collectImageKeys(undefined, 'image')).toEqual([]);
  });
});

describe('extractInboundImageKeys', () => {
  it('pulls keys off a raw receive event', () => {
    expect(extractInboundImageKeys(event('image', { image_key: 'img_z' }))).toEqual(['img_z']);
  });

  it('returns [] when there is no message', () => {
    expect(extractInboundImageKeys({})).toEqual([]);
    expect(extractInboundImageKeys(null)).toEqual([]);
  });
});
