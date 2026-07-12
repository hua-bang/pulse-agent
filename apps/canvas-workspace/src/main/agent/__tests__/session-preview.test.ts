import { describe, expect, it } from 'vitest';
import { sessionPreview } from '../session-preview';

describe('sessionPreview', () => {
  it('preserves a complete leading DOM marker while truncating only the prose', () => {
    const marker = '@[dom:dom-mqfcp3zq-16g73y|span%3A%203%20items]';

    expect(sessionPreview(`${marker} 这块区域描述了啥，并说明其中的交互`, 8))
      .toBe(`${marker} 这块区域描述了啥`);
  });
});
