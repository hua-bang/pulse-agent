import { describe, expect, it } from 'vitest';

import { parseVisualToolResult } from '../../artifacts/parseVisualToolResult';
import { parseGeneratedImage } from '../GeneratedImageActions';

const piTextEnvelope = (payload: unknown): string => JSON.stringify([{
  type: 'text',
  text: JSON.stringify(payload),
}]);

describe('persisted rich tool results', () => {
  it('restores an inline visual from a Pi text-content envelope', () => {
    const payload = {
      ok: true,
      kind: 'visual_render',
      type: 'html' as const,
      title: 'Inline HTML',
      content: '<main>kept after streaming</main>',
    };

    expect(parseVisualToolResult('visual_render', piTextEnvelope(payload))).toEqual({
      kind: 'visual_render',
      payload: {
        type: 'html',
        title: 'Inline HTML',
        content: '<main>kept after streaming</main>',
      },
    });
  });

  it('restores a generated image from a Pi text-content envelope', () => {
    const payload = {
      ok: true,
      type: 'generated_image',
      title: 'Generated image',
      outputPath: '/tmp/generated.png',
      mimeType: 'image/png',
    };

    expect(parseGeneratedImage(piTextEnvelope(payload))).toEqual(payload);
  });
});
