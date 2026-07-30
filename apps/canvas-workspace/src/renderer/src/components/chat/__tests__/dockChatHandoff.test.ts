import { describe, expect, it } from 'vitest';
import { resolveDockChatHandoff } from '../dockChatHandoff';

describe('resolveDockChatHandoff', () => {
  it('carries the task id so the dock keeps showing the task conversation', () => {
    expect(resolveDockChatHandoff({ kind: 'scheduled', taskId: 'daily-brief' }))
      .toEqual({ kind: 'scheduled', taskId: 'daily-brief' });
  });

  it('lands workspace and global scopes on the plain dock chat tab', () => {
    expect(resolveDockChatHandoff({ kind: 'workspace', workspaceId: 'ws-1' })).toEqual({ kind: 'chat' });
    expect(resolveDockChatHandoff({ kind: 'global' })).toEqual({ kind: 'chat' });
  });
});
