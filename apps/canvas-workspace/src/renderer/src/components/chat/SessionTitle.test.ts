import { describe, expect, it } from 'vitest';
import { sessionTitleText } from './utils/sessionTitle';

describe('sessionTitleText', () => {
  it('uses a DOM reference label without exposing its internal id', () => {
    const title = sessionTitleText('@[dom:dom-mqfcp3zq-16g73y|span%3A%203%20items] 这块区域描述了啥');

    expect(title).toBe('span: 3 items 这块区域描述了啥');
    expect(title).not.toContain('dom-mqfcp3zq-16g73y');
  });

  it('handles legacy labels with a bracketed suffix without leaving a stray bracket', () => {
    expect(sessionTitleText('@[dom:dom-1|header: Fancy Builder [...truncated]] 这块区域描述了啥'))
      .toBe('header: Fancy Builder [...truncated] 这块区域描述了啥');
  });
});
