import { describe, expect, it } from 'vitest';
import type { CrossWorkspaceSessionGroup } from '../../../../../shared/agent-chat';
import { partitionSessionGroups } from './sessionListGroups';

const session = {
  sessionId: 'session-1',
  date: '2026-08-12',
  messageCount: 1,
  isCurrent: true,
};

describe('partitionSessionGroups', () => {
  it('preserves explicit scope ownership without decoding storage ids', () => {
    const groups: CrossWorkspaceSessionGroup[] = [
      {
        scopeName: 'Global Chat',
        scope: { kind: 'global' },
        sessions: [session],
      },
      {
        scopeName: 'Workspace A',
        scope: { kind: 'workspace', workspaceId: 'workspace-a' },
        sessions: [{ ...session, sessionId: 'session-2', isCurrent: false }],
      },
    ];

    const result = partitionSessionGroups(groups, { kind: 'global' });

    expect(result.sessions).toEqual([session]);
    expect(result.otherSessions[0]).toMatchObject({
      sourceScope: { kind: 'workspace', workspaceId: 'workspace-a' },
    });
    expect(result.otherSessions[0]).not.toHaveProperty('sourceWorkspaceId');
  });
});
