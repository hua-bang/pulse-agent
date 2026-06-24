import { describe, it, expect } from 'vitest';
import { extractGeneratedImageResult } from '../image-result';

// The canvas image tools return a JSON-encoded string; mirror their real shape.
function canvasGenerateImageResult(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    ok: true,
    type: 'generated_image',
    title: 'A cat',
    outputPath: '/tmp/canvas/ws1/images/generated-1.png',
    mimeType: 'image/png',
    bytes: 1234,
    provider: 'openai',
    model: 'gpt-image-1',
    addToCanvasAction: { workspaceId: 'ws1', imagePath: '/tmp/canvas/ws1/images/generated-1.png' },
    ...overrides,
  });
}

describe('extractGeneratedImageResult', () => {
  it('relays the canvas_generate_image payload (known tool)', () => {
    const image = extractGeneratedImageResult({
      name: 'canvas_generate_image',
      result: canvasGenerateImageResult(),
    });
    expect(image).toEqual({
      outputPath: '/tmp/canvas/ws1/images/generated-1.png',
      mimeType: 'image/png',
    });
  });

  it('relays a canvas_screenshot result so the bot sends the capture', () => {
    const image = extractGeneratedImageResult({
      name: 'canvas_screenshot',
      result: JSON.stringify({
        ok: true,
        type: 'screenshot',
        target: 'screen',
        title: 'Entire Screen',
        outputPath: '/tmp/canvas/_global/screenshots/screen-1.png',
        mimeType: 'image/png',
      }),
    });
    expect(image).toEqual({
      outputPath: '/tmp/canvas/_global/screenshots/screen-1.png',
      mimeType: 'image/png',
    });
  });

  it('relays canvas_generate_mindmap_image', () => {
    const image = extractGeneratedImageResult({
      name: 'canvas_generate_mindmap_image',
      result: canvasGenerateImageResult({ type: 'generated_image' }),
    });
    expect(image?.outputPath).toBe('/tmp/canvas/ws1/images/generated-1.png');
  });

  it('relays a known image tool even when mimeType is missing (no fallback dependency)', () => {
    // looksLikeImagePayload() would reject this (no image/* mime), but trusting
    // the tool name keeps the image flowing — sendImageMessage defaults the mime.
    const image = extractGeneratedImageResult({
      name: 'canvas_generate_image',
      result: JSON.stringify({ ok: true, outputPath: '/tmp/x.png' }),
    });
    expect(image).toEqual({ outputPath: '/tmp/x.png', mimeType: undefined });
  });

  it('still relays unknown tools when the payload looks like an image', () => {
    const image = extractGeneratedImageResult({
      name: 'some_other_tool',
      result: JSON.stringify({ outputPath: '/tmp/y.webp', mimeType: 'image/webp' }),
    });
    expect(image).toEqual({ outputPath: '/tmp/y.webp', mimeType: 'image/webp' });
  });

  it('ignores an unknown tool whose payload is not image-shaped', () => {
    const image = extractGeneratedImageResult({
      name: 'some_other_tool',
      result: JSON.stringify({ outputPath: '/tmp/report.txt', mimeType: 'text/plain' }),
    });
    expect(image).toBeNull();
  });

  it('ignores non-image tool results (no outputPath)', () => {
    expect(
      extractGeneratedImageResult({
        name: 'canvas_analyze_image',
        result: JSON.stringify({ ok: true, imageCount: 2, imagePaths: ['/a.png', '/b.png'] }),
      }),
    ).toBeNull();
  });

  it('returns null for non-JSON or empty results', () => {
    expect(extractGeneratedImageResult({ name: 'canvas_generate_image', result: 'done' })).toBeNull();
    expect(extractGeneratedImageResult({ name: 'canvas_generate_image' })).toBeNull();
    expect(extractGeneratedImageResult({})).toBeNull();
  });
});
