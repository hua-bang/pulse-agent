import { useEffect, useRef } from 'react';
import type {
  RemoteVpsChatRoomActiveTurn,
  RemoteVpsChatRoomQueuedItem,
} from '../../../../../../shared/api/remote-vps';
import type { AgentChatMessage } from '../../../../types';
import { Button } from '../../../../components/ui/Button';
import { useI18n } from '../../../../i18n';
import { setRemotePeers, useRemotePeers } from '../../../../shared/remotePresence';
import './PeerStreamBridge.css';

interface Props {
  workspaceId: string;
  conversationId: string;
  messages: readonly AgentChatMessage[];
  loading: boolean;
  roomActiveTurn?: RemoteVpsChatRoomActiveTurn | null;
  roomQueue?: readonly RemoteVpsChatRoomQueuedItem[];
  onCancelQueued?: (itemId: string) => void;
  onNewBranch?: () => void;
  onPeerStreamFinished?: () => void;
}

/**
 * Syncs live AI streaming state over VPS presence (legacy fallback) and displays
 * ~150ms SSE shared chat-room active turn + FIFO queue when available.
 */
export const PeerStreamBridge = ({
  workspaceId,
  conversationId,
  messages,
  loading,
  roomActiveTurn,
  roomQueue = [],
  onCancelQueued,
  onNewBranch,
  onPeerStreamFinished,
}: Props) => {
  const { t } = useI18n();
  const peers = useRemotePeers(workspaceId);
  const sentActiveRef = useRef(false);
  const lastAssistant = messages.length > 0 && messages[messages.length - 1].role === 'assistant'
    ? messages[messages.length - 1].content
    : '';
  const latestTextRef = useRef(lastAssistant);
  latestTextRef.current = lastAssistant;

  // Outbound presence fallback for older daemons without /v1/chat-room.
  useEffect(() => {
    const api = window.canvasWorkspace?.remoteVps;
    if (!api?.updatePresence || !workspaceId || !conversationId) return;

    if (!loading) {
      if (sentActiveRef.current) {
        sentActiveRef.current = false;
        void api.updatePresence(workspaceId, { chatStream: null }).then((res) => {
          if (res.ok) setRemotePeers(workspaceId, res.peers);
        }).catch(() => undefined);
      }
      return;
    }

    let cancelled = false;
    const push = () => {
      sentActiveRef.current = true;
      const preview = latestTextRef.current.slice(-2400);
      void api.updatePresence?.(workspaceId, {
        chatStream: { conversationId, text: preview },
      }).then((res) => {
        if (!cancelled && res.ok) setRemotePeers(workspaceId, res.peers);
      }).catch(() => undefined);
    };

    push();
    const timer = window.setInterval(push, 1_200);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [workspaceId, conversationId, loading]);

  const streamingPeer = peers.find(
    (peer) => peer.chatStream && (!conversationId || peer.chatStream.conversationId === conversationId),
  );

  // Inbound fallback: reload the conversation once a teammate's presence stream completes.
  const wasPeerStreamingRef = useRef(false);
  useEffect(() => {
    const active = Boolean(streamingPeer?.chatStream);
    if (wasPeerStreamingRef.current && !active) {
      onPeerStreamFinished?.();
    }
    wasPeerStreamingRef.current = active;
  }, [streamingPeer?.chatStream, onPeerStreamFinished]);

  const peerRoomTurn = roomActiveTurn && !roomActiveTurn.self ? roomActiveTurn : null;
  const activeName = peerRoomTurn?.senderName ?? streamingPeer?.name;
  // When peerRoomTurn is active, the live reply renders inline in the message thread;
  // only show the top preview box for legacy presence fallback (older daemons).
  const legacyPreviewText = peerRoomTurn ? '' : (streamingPeer?.chatStream?.text ?? '');
  const showActive = Boolean(peerRoomTurn || streamingPeer?.chatStream);
  const showQueue = roomQueue.length > 0;

  if (!showActive && !showQueue) return null;

  return (
    <div className="chat-peer-stream" role="status" aria-live="polite">
      {showActive && activeName && (
        <>
          <div className="chat-peer-stream__header">
            <span className="chat-peer-stream__status">
              <span className="chat-peer-stream__dot" aria-hidden="true" />
              <span>{t('presence.peerStreaming', { name: activeName })}</span>
            </span>
            {onNewBranch && (
              <Button size="sm" variant="secondary" onClick={onNewBranch}>
                {t('presence.newBranch')}
              </Button>
            )}
          </div>
          {legacyPreviewText && (
            <div className="chat-peer-stream__preview">{legacyPreviewText}</div>
          )}
        </>
      )}
      {showQueue && (
        <div className="chat-peer-stream__queue">
          <div className="chat-peer-stream__queue-title">
            {t('chatRoom.queuedLabel', { count: String(roomQueue.length) })}
          </div>
          {roomQueue.map((item, idx) => (
            <div key={item.id} className="chat-peer-stream__queue-item">
              <span className="chat-peer-stream__queue-sender">
                #{idx + 1} {item.senderName}
              </span>
              <span className="chat-peer-stream__queue-text">{item.message}</span>
              {item.self && onCancelQueued && (
                <Button size="sm" variant="secondary" onClick={() => onCancelQueued(item.id)}>
                  {t('chatRoom.cancelQueued')}
                </Button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
