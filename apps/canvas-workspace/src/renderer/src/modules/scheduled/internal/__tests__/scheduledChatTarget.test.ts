import { describe, expect, it } from 'vitest';
import { resolveScheduledChatTarget } from '../scheduledChatTarget';

const target = (activeView: string) =>
  resolveScheduledChatTarget({ activeView, taskId: 'daily brief', chatRoute: '/chat' });

describe('resolveScheduledChatTarget', () => {
  it('opens the dock tab from every view that has one, never navigating away', () => {
    for (const activeView of ['canvas', 'scheduled', 'nodes', 'node-detail', 'graph', 'skills', '/plugin-route']) {
      expect(target(activeView), activeView).toEqual({ kind: 'dock' });
    }
  });

  it('falls back to the AI Chat route only where a full-page chat owns the surface', () => {
    // Those views hide the dock chat tab, so a dock open would show nothing.
    expect(target('chat')).toEqual({ kind: 'route', path: '/chat?scheduledTask=daily%20brief' });
    expect(target('scheduled-task')).toEqual({ kind: 'route', path: '/chat?scheduledTask=daily%20brief' });
  });
});
