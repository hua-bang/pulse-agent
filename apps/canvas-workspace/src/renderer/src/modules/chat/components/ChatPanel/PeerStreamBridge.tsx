import { useEffect, useRef } from 'react';
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
  onNewBranch?: () => void;
}

/**
 * Syncs live AI streaming state over VPS presence:
 * - Outbound: throttles this client's active assistant reply preview while streaming.
 * - Inbound: displays a live preview + polite "New branch" action when a teammate is streaming.
 */
export const PeerStreamBridge = ({
  workspaceId,
  conversationId,
  messages,
  loading,
  onNewBranch,
}: Props) => {
  const { t } = useI18n();
  const peers = useRemotePeers(workspaceId);
  const lastSentRef = useRef<string | null>(null);
  const lastAssistant = messages.length > 0 && messages[messages.length - 1].role === 'assistant'
    ? messages[messages.length - 1].content
    : '';

  // Outbound: broadcast active streaming preview every ~1.2s and clear once idle.
  useEffect(() => {
    const api = window.canvasWorkspace?.remoteVps;
    if (!api?.updatePresence || !workspaceId || !conversationId) return;

    if (!loading) {
      if (lastSentRef.current !== null) {
        lastSentRef.current = null;
        void api.updatePresence(workspaceId, { chatStream: null }).then((res) => {
          if (res.ok) setRemotePeers(workspaceId, res.peers);
        }).catch(() => undefined);
      }
      return;
    }

    const preview = lastAssistant.slice(-2400);
    const signature = `${conversationId}:${preview.length}`;
    if (lastSentRef.current === signature) return;

    const timer = window.setTimeout(() => {
      lastSentRef.current = signature;
      void api.updatePresence?.(workspaceId, {
        chatStream: { conversationId, text: preview },
      }).then((res) => {
        if (res.ok) setRemotePeers(workspaceId, res.peers);
      }).catch(() => undefined);
    }, 1_100);

    return () => window.clearTimeout(timer);
  }, [workspaceId, conversationId, loading, lastAssistant]);

  const streamingPeer = peers.find(
    (peer) => peer.chatStream && peer.chatStream.conversationId === conversationId,
  );
  if (!streamingPeer?.chatStream) return null;

  return (
    <div className="chat-peer-stream" role="status" aria-live="polite">
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
      {streamingPeer.chatStream.text && (
        <div className="chat-peer-stream__preview">{streamingPeer.chatStream.text}</div>
      )}
    </div>
  );
};
