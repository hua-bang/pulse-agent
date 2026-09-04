import { describe, expect, it, vi } from 'vitest';
import type { InlineVisualPayload } from './types';
import { createArtifactPromotion } from './artifactPromotion';

const PAYLOAD: InlineVisualPayload = {
  type: 'html',
  title: 'Chart',
  content: '<div>chart</div>',
};

describe('createArtifactPromotion', () => {
  it('deduplicates concurrent promotion and reuses the saved artifact id', async () => {
    let resolveCreate: ((id: string | null) => void) | undefined;
    const create = vi.fn(() => new Promise<string | null>((resolve) => {
      resolveCreate = resolve;
    }));
    const promotion = createArtifactPromotion(create);

    const first = promotion.promote(PAYLOAD);
    const second = promotion.promote(PAYLOAD);
    expect(create).toHaveBeenCalledTimes(1);
    resolveCreate?.('artifact-1');

    await expect(first).resolves.toBe('artifact-1');
    await expect(second).resolves.toBe('artifact-1');
    await expect(promotion.promote(PAYLOAD)).resolves.toBe('artifact-1');
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('allows a retry when creation returns no artifact', async () => {
    const create = vi.fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce('artifact-2');
    const promotion = createArtifactPromotion(create);

    await expect(promotion.promote(PAYLOAD)).resolves.toBeNull();
    await expect(promotion.promote(PAYLOAD)).resolves.toBe('artifact-2');
    expect(create).toHaveBeenCalledTimes(2);
  });
});
