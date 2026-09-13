import { describe, expect, it } from 'vitest';
import { readReferenceDrag } from './drag';

describe('Library reference drag payload', () => {
  it('keeps source identity and preview hints for an unloaded external node', () => {
    const entry = { kind: 'node', workspaceId: 'other', nodeId: 'note', titleSnapshot: 'Notes', typeSnapshot: 'file', workspaceNameSnapshot: 'Research' };
    expect(readReferenceDrag(JSON.stringify(entry))).toEqual(entry);
  });
  it('rejects unrelated drops and strips unexpected fields', () => {
    expect(readReferenceDrag('https://example.com')).toBeNull();
    expect(readReferenceDrag('{"kind":"node"}')).toBeNull();
    expect(readReferenceDrag(JSON.stringify({ kind: 'node', workspaceId: 'a', nodeId: 'b', data: { content: 'injected' }, typeSnapshot: 'unknown' })))
      .toEqual({ kind: 'node', workspaceId: 'a', nodeId: 'b' });
  });
});
