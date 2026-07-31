import type {
  WebviewRegistrationIdentity,
  WebviewSurfaceKind,
} from '../../shared/webview-registration';

export interface WebviewRegistrationKey {
  workspaceId: string;
  nodeId: string;
}

const keyOf = (key: WebviewRegistrationKey): string =>
  `${key.workspaceId}::${key.nodeId}`;

/**
 * Keeps node and guest lookups consistent when either identity is rebound.
 *
 * More than one guest may legitimately present the same canvas node at once
 * (for example, the main canvas and a dock node-detail preview). `byNode`
 * selects the most recently announced presentation for node-oriented reads,
 * while `byWebContentsId` retains every mounted presentation so navigation
 * and shortcut policy can always resolve the exact source guest.
 */
export class WebviewRegistrationStore {
  private readonly byNode = new Map<string, WebviewRegistrationIdentity>();

  private readonly byWebContentsId = new Map<number, WebviewRegistrationIdentity>();

  private promoteNewestPresentation(nodeKey: string): void {
    this.byNode.delete(nodeKey);
    // Map iteration preserves registration insertion order, so the final
    // matching candidate is the newest still-mounted presentation.
    for (const candidate of this.byWebContentsId.values()) {
      if (keyOf(candidate) === nodeKey) this.byNode.set(nodeKey, candidate);
    }
  }

  get size(): number {
    return this.byWebContentsId.size;
  }

  register(
    key: WebviewRegistrationKey,
    webContentsId: number,
    surfaceKind: WebviewSurfaceKind,
  ): boolean {
    const nodeKey = keyOf(key);
    const previousForGuest = this.byWebContentsId.get(webContentsId);
    if (previousForGuest) {
      const previousGuestKey = keyOf(previousForGuest);
      if (previousGuestKey !== nodeKey) {
        this.byWebContentsId.delete(webContentsId);
        if (this.byNode.get(previousGuestKey) === previousForGuest) {
          this.promoteNewestPresentation(previousGuestKey);
        }
      }
    }
    const registration: WebviewRegistrationIdentity = {
      workspaceId: key.workspaceId,
      nodeId: key.nodeId,
      webContentsId,
      surfaceKind,
    };
    this.byNode.set(nodeKey, registration);
    this.byWebContentsId.set(webContentsId, registration);
    return previousForGuest === undefined;
  }

  unregister(key: WebviewRegistrationKey, expectedWebContentsId?: number): boolean {
    const nodeKey = keyOf(key);
    const registration = expectedWebContentsId === undefined
      ? this.byNode.get(nodeKey)
      : this.byWebContentsId.get(expectedWebContentsId);
    if (!registration) return false;
    if (keyOf(registration) !== nodeKey) return false;
    this.byWebContentsId.delete(registration.webContentsId);
    if (this.byNode.get(nodeKey)?.webContentsId === registration.webContentsId) {
      this.promoteNewestPresentation(nodeKey);
    }
    return true;
  }

  unregisterByWebContentsId(webContentsId: number): boolean {
    const registration = this.byWebContentsId.get(webContentsId);
    if (!registration) return false;
    return this.unregister(registration, webContentsId);
  }

  getByNode(key: WebviewRegistrationKey): WebviewRegistrationIdentity | undefined {
    return this.byNode.get(keyOf(key));
  }

  getByWebContentsId(webContentsId: number): WebviewRegistrationIdentity | undefined {
    return this.byWebContentsId.get(webContentsId);
  }

  values(): IterableIterator<WebviewRegistrationIdentity> {
    return this.byWebContentsId.values();
  }
}
