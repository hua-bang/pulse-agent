import { describe, expect, it, vi } from 'vitest';
import type { ClipboardImageResult } from '../shared/clipboard-image.js';
import { buildPasteHandler } from './paste-handler.js';

const imageResult: ClipboardImageResult = {
  dataUrl: 'data:image/png;base64,AAAA',
  mimeType: 'image/png',
  source: 'test',
};

describe('buildPasteHandler', () => {
  it('inserts non-empty text pastes into the composer', () => {
    const insertPastedText = vi.fn();
    const readImage = vi.fn();
    const submitImage = vi.fn();
    const handler = buildPasteHandler({ insertPastedText, readImage, submitImage });

    handler('https://example.com');

    expect(insertPastedText).toHaveBeenCalledWith('https://example.com');
    expect(readImage).not.toHaveBeenCalled();
    expect(submitImage).not.toHaveBeenCalled();
  });

  it('reads the clipboard and submits an image when the paste payload is empty', async () => {
    const insertPastedText = vi.fn();
    const readImage = vi.fn().mockResolvedValue(imageResult);
    const submitImage = vi.fn();
    const handler = buildPasteHandler({ insertPastedText, readImage, submitImage });

    handler('');

    await vi.waitFor(() => expect(submitImage).toHaveBeenCalledWith(imageResult));
    expect(insertPastedText).not.toHaveBeenCalled();
  });

  it('stays silent when the empty paste has no clipboard image', async () => {
    const insertPastedText = vi.fn();
    const readImage = vi.fn().mockResolvedValue(null);
    const submitImage = vi.fn();
    const handler = buildPasteHandler({ insertPastedText, readImage, submitImage });

    handler('');

    await vi.waitFor(() => expect(readImage).toHaveBeenCalled());
    expect(submitImage).not.toHaveBeenCalled();
    expect(insertPastedText).not.toHaveBeenCalled();
  });

  it('does not crash when reading the clipboard fails', async () => {
    const insertPastedText = vi.fn();
    const readImage = vi.fn().mockRejectedValue(new Error('platform unsupported'));
    const submitImage = vi.fn();
    const handler = buildPasteHandler({ insertPastedText, readImage, submitImage });

    handler('');

    await vi.waitFor(() => expect(readImage).toHaveBeenCalled());
    expect(submitImage).not.toHaveBeenCalled();
    expect(insertPastedText).not.toHaveBeenCalled();
  });

  it('treats whitespace-only payloads as an image paste (no text to insert)', async () => {
    const insertPastedText = vi.fn();
    const readImage = vi.fn().mockResolvedValue(imageResult);
    const submitImage = vi.fn();
    const handler = buildPasteHandler({ insertPastedText, readImage, submitImage });

    handler('   ');

    await vi.waitFor(() => expect(submitImage).toHaveBeenCalledWith(imageResult));
    expect(insertPastedText).not.toHaveBeenCalled();
  });
});
