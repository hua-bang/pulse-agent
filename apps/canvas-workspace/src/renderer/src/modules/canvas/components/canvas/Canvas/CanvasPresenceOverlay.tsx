import { useEffect, useRef } from 'react';
import type { CanvasNode, CanvasTransform } from '../../../../../types';
import { Button } from '../../../../../components/ui/Button';
import { useI18n } from '../../../../../i18n';
import {
  peerToneForName,
  setRemotePeers,
  stopFollowingPeer,
  useFollowingPeerId,
  useRemotePeers,
  useWorkspaceViewerReadOnly,
} from '../../../../../shared/remotePresence';
import './CanvasPresenceOverlay.css';

interface OverlayProps {
  canvasId: string;
  selectedNodeId: string | null;
  transform: CanvasTransform;
  moving: boolean;
  nodesById: Map<string, CanvasNode>;
  onFollowNode: (node: CanvasNode) => void;
}

/**
 * Publishes local presence heartbeats to VPS (activeNodeId + viewport),
 * drives Follow mode auto-centering, and renders the Follow / Viewer-reading pills.
 */
export const CanvasPresenceOverlay = ({
  canvasId,
  selectedNodeId,
  transform,
  moving,
  nodesById,
  onFollowNode,
}: OverlayProps) => {
  const { t } = useI18n();
  const peers = useRemotePeers(canvasId);
  const followingPeerId = useFollowingPeerId(canvasId);
  const viewerReadOnly = useWorkspaceViewerReadOnly(canvasId);
  const followingPeer = followingPeerId
    ? peers.find((peer) => peer.clientId === followingPeerId) ?? null
    : null;
  const lastFollowedNodeRef = useRef<string | null>(null);
  const latestStateRef = useRef({ selectedNodeId, transform });
  latestStateRef.current = { selectedNodeId, transform };

  // Report local presence on selection/viewport settle + periodic 15s keepalive.
  useEffect(() => {
    const api = window.canvasWorkspace?.remoteVps;
    if (!api?.updatePresence || !canvasId) return;
    let cancelled = false;
    const send = () => {
      const { selectedNodeId: nodeId, transform: vp } = latestStateRef.current;
      void api.updatePresence?.(canvasId, {
        activeNodeId: nodeId,
        viewport: { x: Math.round(vp.x), y: Math.round(vp.y), scale: Number(vp.scale.toFixed(3)) },
      }).then((res) => {
        if (!cancelled && res.ok) setRemotePeers(canvasId, res.peers);
      }).catch(() => undefined);
    };
    const debounce = window.setTimeout(send, 700);
    const keepalive = window.setInterval(send, 15_000);
    return () => {
      cancelled = true;
      window.clearTimeout(debounce);
      window.clearInterval(keepalive);
    };
  }, [canvasId, selectedNodeId, transform.x, transform.y, transform.scale]);

  // Cleanly remove presence when switching away from or unmounting this canvas.
  useEffect(() => {
    const api = window.canvasWorkspace?.remoteVps;
    if (!api?.leavePresence || !canvasId) return;
    return () => {
      void api.leavePresence?.(canvasId).catch(() => undefined);
    };
  }, [canvasId]);

  // Follow the selected peer's active node whenever it changes.
  useEffect(() => {
    if (!followingPeer?.activeNodeId) {
      lastFollowedNodeRef.current = null;
      return;
    }
    if (lastFollowedNodeRef.current === followingPeer.activeNodeId) return;
    const node = nodesById.get(followingPeer.activeNodeId);
    if (!node) return;
    lastFollowedNodeRef.current = node.id;
    onFollowNode(node);
  }, [followingPeer?.activeNodeId, nodesById, onFollowNode]);

  // Auto-exit Follow mode if the user manually pans or zooms the canvas.
  useEffect(() => {
    if (moving && followingPeerId) {
      stopFollowingPeer(canvasId);
    }
  }, [canvasId, followingPeerId, moving]);

  if (followingPeer) {
    return (
      <div className="canvas-presence-banner" role="status" aria-live="polite">
        <span className="canvas-presence-banner__dot" aria-hidden="true" />
        <span>{t('presence.following', { name: followingPeer.name })}</span>
        <Button size="sm" variant="secondary" onClick={() => stopFollowingPeer(canvasId)}>
          {t('presence.stopFollow')}
        </Button>
      </div>
    );
  }

  if (viewerReadOnly) {
    return (
      <div className="canvas-presence-viewer-pill" role="status">
        <span>{t('presence.viewerReadOnly')}</span>
      </div>
    );
  }

  return null;
};

interface HalosProps {
  workspaceId?: string;
  nodes: readonly CanvasNode[];
}

/** Node-level ambient presence rings painted in canvas space without re-rendering cards. */
export const CanvasPeerHalos = ({ workspaceId, nodes }: HalosProps) => {
  const peers = useRemotePeers(workspaceId);
  if (peers.length === 0) return null;

  const byNodeId = new Map<string, string[]>();
  for (const peer of peers) {
    if (!peer.activeNodeId) continue;
    const list = byNodeId.get(peer.activeNodeId);
    if (list) list.push(peer.name);
    else byNodeId.set(peer.activeNodeId, [peer.name]);
  }
  if (byNodeId.size === 0) return null;

  return (
    <>
      {nodes.map((node) => {
        const names = byNodeId.get(node.id);
        if (!names) return null;
        return (
          <div
            key={`peer-halo:${node.id}`}
            className={`canvas-peer-halo canvas-peer-halo--${peerToneForName(names[0])}`}
            style={{
              left: node.x - 3,
              top: node.y - 3,
              width: node.width + 6,
              height: node.height + 6,
            }}
            aria-hidden="true"
          >
            <span className="canvas-peer-halo__tag">{names.join(', ')}</span>
          </div>
        );
      })}
    </>
  );
};
