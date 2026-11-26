export type PresenceRole = 'admin' | 'viewer' | 'editor' | 'collaborator';

export interface PresenceViewport {
  x: number;
  y: number;
  scale: number;
}

export interface PresenceChatStream {
  conversationId: string;
  text: string;
}

export interface PresencePeer {
  clientId: string;
  name: string;
  role: PresenceRole;
  activeNodeId?: string;
  viewport?: PresenceViewport;
  chatStream?: PresenceChatStream;
  updatedAt: number;
}

export interface PresenceUpsertInput {
  clientId: string;
  name: string;
  role: PresenceRole;
  activeNodeId?: string;
  viewport?: PresenceViewport;
  chatStream?: PresenceChatStream;
}

const DEFAULT_TTL_MS = 35_000;

export class PresenceHub {
  private readonly workspaces = new Map<string, Map<string, PresencePeer>>();

  constructor(private readonly ttlMs = DEFAULT_TTL_MS) {}

  upsert(workspaceId: string, input: PresenceUpsertInput, now = Date.now()): PresencePeer[] {
    let peers = this.workspaces.get(workspaceId);
    if (!peers) {
      peers = new Map();
      this.workspaces.set(workspaceId, peers);
    }
    this.pruneMap(peers, now);
    const peer: PresencePeer = {
      clientId: input.clientId,
      name: input.name,
      role: input.role,
      ...(input.activeNodeId ? { activeNodeId: input.activeNodeId } : {}),
      ...(input.viewport ? { viewport: input.viewport } : {}),
      ...(input.chatStream ? { chatStream: input.chatStream } : {}),
      updatedAt: now,
    };
    peers.set(input.clientId, peer);
    return this.sortPeers(peers);
  }

  remove(workspaceId: string, clientId: string, now = Date.now()): PresencePeer[] {
    const peers = this.workspaces.get(workspaceId);
    if (!peers) return [];
    peers.delete(clientId);
    this.pruneMap(peers, now);
    if (peers.size === 0) {
      this.workspaces.delete(workspaceId);
      return [];
    }
    return this.sortPeers(peers);
  }

  list(workspaceId: string, now = Date.now()): PresencePeer[] {
    const peers = this.workspaces.get(workspaceId);
    if (!peers) return [];
    this.pruneMap(peers, now);
    if (peers.size === 0) {
      this.workspaces.delete(workspaceId);
      return [];
    }
    return this.sortPeers(peers);
  }

  private pruneMap(peers: Map<string, PresencePeer>, now: number): void {
    for (const [id, peer] of peers.entries()) {
      if (now - peer.updatedAt > this.ttlMs) {
        peers.delete(id);
      }
    }
  }

  private sortPeers(peers: Map<string, PresencePeer>): PresencePeer[] {
    return Array.from(peers.values()).sort((a, b) => a.clientId.localeCompare(b.clientId));
  }
}
