import { useSyncExternalStore } from 'react';
import type { RemoteVpsPresencePeer } from '../../../shared/api/remote-vps';

const EMPTY_PEERS: readonly RemoteVpsPresencePeer[] = [];

const peersByWorkspace = new Map<string, readonly RemoteVpsPresencePeer[]>();
const followingByWorkspace = new Map<string, string | null>();
const viewerReadOnlyByWorkspace = new Map<string, boolean>();
const listeners = new Set<() => void>();

const emit = () => {
  for (const listener of listeners) listener();
};

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

export function setRemotePeers(workspaceId: string, peers: readonly RemoteVpsPresencePeer[]): void {
  const remoteOnly = peers.filter((p) => !p.self);
  peersByWorkspace.set(workspaceId, remoteOnly);
  const currentFollow = followingByWorkspace.get(workspaceId);
  if (currentFollow && !remoteOnly.some((p) => p.clientId === currentFollow)) {
    followingByWorkspace.delete(workspaceId);
  }
  emit();
}

export function setWorkspaceViewerReadOnly(workspaceId: string, readOnly: boolean): void {
  if ((viewerReadOnlyByWorkspace.get(workspaceId) ?? false) === readOnly) return;
  viewerReadOnlyByWorkspace.set(workspaceId, readOnly);
  emit();
}

export function startFollowingPeer(workspaceId: string, clientId: string): void {
  followingByWorkspace.set(workspaceId, clientId);
  emit();
}

export function stopFollowingPeer(workspaceId: string): void {
  if (!followingByWorkspace.get(workspaceId)) return;
  followingByWorkspace.delete(workspaceId);
  emit();
}

export function useRemotePeers(workspaceId: string | null | undefined): readonly RemoteVpsPresencePeer[] {
  return useSyncExternalStore(
    subscribe,
    () => (workspaceId ? peersByWorkspace.get(workspaceId) ?? EMPTY_PEERS : EMPTY_PEERS),
    () => EMPTY_PEERS,
  );
}

export function useFollowingPeerId(workspaceId: string | null | undefined): string | null {
  return useSyncExternalStore(
    subscribe,
    () => (workspaceId ? followingByWorkspace.get(workspaceId) ?? null : null),
    () => null,
  );
}

export function useWorkspaceViewerReadOnly(workspaceId: string | null | undefined): boolean {
  return useSyncExternalStore(
    subscribe,
    () => (workspaceId ? viewerReadOnlyByWorkspace.get(workspaceId) ?? false : false),
    () => false,
  );
}

/** Build a clickable `pulse-canvas://join?code=...` deep link from a share invite code. */
export function buildJoinDeepLink(inviteCode: string): string {
  const stripped = inviteCode.trim().replace(/^pulse-share:\/\/v1\//, '');
  return `pulse-canvas://join?code=${encodeURIComponent(stripped)}`;
}
