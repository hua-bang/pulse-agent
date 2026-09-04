import { describe, expect, it } from 'vitest';
import { extractMentionedWorkspaceIds } from './extractMentionedWorkspaceIds';

const workspaces = [
  { id: 'current', name: 'Current' },
  { id: 'product', name: 'Product' },
  { id: 'research', name: 'Research' },
];

describe('extractMentionedWorkspaceIds', () => {
  it('returns distinct non-current workspace ids in mention order', () => {
    expect(extractMentionedWorkspaceIds(
      '@[canvas:Product] compare @[canvas:Research] with @[canvas:Product]',
      workspaces,
      'current',
    )).toEqual(['product', 'research']);
  });

  it('ignores current and unknown workspace mentions', () => {
    expect(extractMentionedWorkspaceIds(
      '@[canvas:Current] @[canvas:Missing]',
      workspaces,
      'current',
    )).toEqual([]);
  });
});
