import { useSyncExternalStore } from 'react';
import type { RemoteVpsPresencePeer } from '../../../shared/api/remote-vps';

const EMPTY_PEERS: readonly RemoteVpsPresencePeer[] = [];

const peersByWorkspace = new Map<string, readonly RemoteVpsPresencePeer[]>();
const followingByWorkspace = new Map<string, string | null>();
const viewerReadOnlyByWorkspace = new Map<string, boolean>();
const selfSenderNameByWorkspace = new Map<string, string>();
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

export function setSelfSenderName(workspaceId: string, name: string | undefined): void {
  const trimmed = name?.trim() ?? '';
  if ((selfSenderNameByWorkspace.get(workspaceId) ?? '') === trimmed) return;
  if (trimmed) selfSenderNameByWorkspace.set(workspaceId, trimmed);
  else selfSenderNameByWorkspace.delete(workspaceId);
  emit();
}

export function useSelfSenderName(workspaceId: string | null | undefined): string | undefined {
  return useSyncExternalStore(
    subscribe,
    () => (workspaceId ? selfSenderNameByWorkspace.get(workspaceId) : undefined),
    () => undefined,
  );
}

export type PeerTone = 'accent' | 'term' | 'frame' | 'file';

const PEER_TONES: readonly PeerTone[] = ['accent', 'term', 'frame', 'file'];

/** Deterministic design-token tone shared by top-bar avatars, canvas halos, and chat sender badges. */
export function peerToneForName(name: string): PeerTone {
  const normalized = name.trim().toLowerCase();
  let hash = 0;
  for (let i = 0; i < normalized.length; i += 1) {
    hash = (hash * 31 + normalized.charCodeAt(i)) >>> 0;
  }
  return PEER_TONES[hash % PEER_TONES.length];
}
