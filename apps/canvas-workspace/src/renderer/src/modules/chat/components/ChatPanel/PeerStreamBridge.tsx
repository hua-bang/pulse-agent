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
  chatRoomActive?: boolean;
  roomActiveTurn?: RemoteVpsChatRoomActiveTurn | null;
  roomQueue?: readonly RemoteVpsChatRoomQueuedItem[];
  onCancelQueued?: (itemId: string) => void;
  onNewBranch?: () => void;
  onPeerStreamFinished?: () => void;
}

/**
 * Syncs live AI streaming state over VPS presence (legacy fallback for older daemons)
 * and renders the compact shared FIFO queue strip when teammates have queued messages.
 */
export const PeerStreamBridge = ({
  workspaceId,
  conversationId,
  messages,
  loading,
  chatRoomActive = false,
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

  // Outbound presence fallback ONLY for older daemons without /v1/chat-room.
  useEffect(() => {
    const api = window.canvasWorkspace?.remoteVps;
    if (chatRoomActive || !api?.updatePresence || !workspaceId || !conversationId) return;

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
  }, [chatRoomActive, workspaceId, conversationId, loading]);

  const streamingPeer = chatRoomActive
    ? undefined
    : peers.find(
        (peer) => peer.chatStream && (!conversationId || peer.chatStream.conversationId === conversationId),
      );

  // Inbound fallback: reload the conversation once a teammate's presence stream completes.
  const wasPeerStreamingRef = useRef(false);
  useEffect(() => {
    if (chatRoomActive) return;
    const active = Boolean(streamingPeer?.chatStream);
    if (wasPeerStreamingRef.current && !active) {
      onPeerStreamFinished?.();
    }
    wasPeerStreamingRef.current = active;
  }, [chatRoomActive, streamingPeer?.chatStream, onPeerStreamFinished]);

  // In chat-room mode, live teammate replies render inline inside the message thread,
  // so the top strip is only shown when there are queued messages (no redundant blue bar).
  const showLegacyActive = !chatRoomActive && Boolean(streamingPeer?.chatStream && !roomActiveTurn?.self);
  const showQueue = roomQueue.length > 0;

  if (!showLegacyActive && !showQueue) return null;

  return (
    <div className="chat-peer-stream" role="status" aria-live="polite">
      {showLegacyActive && streamingPeer?.name && (
        <>
          <div className="chat-peer-stream__header">
            <span className="chat-peer-stream__status">
              <span className="chat-peer-stream__dot" aria-hidden="true" />
              <span>{t('presence.peerStreaming', { name: streamingPeer.name })}</span>
            </span>
            {onNewBranch && (
              <Button size="sm" variant="secondary" onClick={onNewBranch}>
                {t('presence.newBranch')}
              </Button>
            )}
          </div>
          {streamingPeer.chatStream?.text && (
            <div className="chat-peer-stream__preview">{streamingPeer.chatStream.text}</div>
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
