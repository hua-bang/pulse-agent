import { describe, expect, it } from 'vitest';
import { sessionPreview } from '../sessions/session-preview';

describe('sessionPreview', () => {
  it('preserves a complete leading DOM marker while truncating only the prose', () => {
    const marker = '@[dom:dom-mqfcp3zq-16g73y|span%3A%203%20items]';

    expect(sessionPreview(`${marker} 这块区域描述了啥，并说明其中的交互`, 8))
      .toBe(`${marker} 这块区域描述了啥`);
  });

  it('extends the cut past a marker it would split instead of leaving half of it', () => {
    const marker = '@[node:node-1791449049720-4|电商营销统计特征专项]';

    expect(sessionPreview(`总结下 ${marker} 的重点`, 8)).toBe(`总结下 ${marker}`);
    expect(sessionPreview(`总结下这个文档里的需求 ${marker}`, 6)).toBe('总结下这个文');
  });
});
