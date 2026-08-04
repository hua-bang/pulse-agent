import { describe, expect, it } from 'vitest';
import { decidePtySessionReuse, describePtySessionReuseRefusal } from './session-binding';

describe('decidePtySessionReuse', () => {
  it('reuses a session spawned for the same workspace', () => {
    expect(decidePtySessionReuse('ws-a', 'ws-a')).toEqual({ reuse: true });
  });

  it('refuses a session spawned for a different workspace', () => {
    // The env of a live PTY cannot be rewritten, so reusing it here would pin
    // the new node's agent to ws-a's canvas while it renders inside ws-b.
    expect(decidePtySessionReuse('ws-a', 'ws-b')).toEqual({
      reuse: false,
      code: 'workspace_mismatch',
      boundWorkspaceId: 'ws-a',
      requestedWorkspaceId: 'ws-b',
    });
  });

  it('stays reusable when either side has no workspace', () => {
    expect(decidePtySessionReuse(undefined, 'ws-b')).toEqual({ reuse: true });
    expect(decidePtySessionReuse('ws-a', undefined)).toEqual({ reuse: true });
    expect(decidePtySessionReuse(undefined, undefined)).toEqual({ reuse: true });
  });

  it('names both workspaces in the refusal message', () => {
    const decision = decidePtySessionReuse('ws-a', 'ws-b');
    expect(decision.reuse).toBe(false);
    if (decision.reuse) return;
    const message = describePtySessionReuseRefusal('node-1', decision);
    expect(message).toContain('node-1');
    expect(message).toContain('ws-a');
    expect(message).toContain('ws-b');
  });
});
