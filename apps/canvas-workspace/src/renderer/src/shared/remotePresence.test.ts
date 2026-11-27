import { describe, expect, it } from 'vitest';
import {
  setRemotePeers,
  setWorkspaceViewerReadOnly,
  startFollowingPeer,
  stopFollowingPeer,
} from './remotePresence';

describe('remotePresence helpers', () => {
  it('tracks peers, follow state, and viewer read-only flag without throwing', () => {
    setRemotePeers('ws-test', [
      { clientId: 'self-1', name: 'Me', role: 'admin', updatedAt: 1, self: true },
      { clientId: 'peer-1', name: 'Alex', role: 'editor', activeNodeId: 'n1', updatedAt: 2 },
    ]);
    startFollowingPeer('ws-test', 'peer-1');
    // Removing the followed peer clears follow state cleanly.
    setRemotePeers('ws-test', []);
    stopFollowingPeer('ws-test');
    setWorkspaceViewerReadOnly('ws-test', true);
    setWorkspaceViewerReadOnly('ws-test', false);
  });
});
