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
  onPeerStreamFinished?: () => void;
}

/**
 * Syncs live AI streaming state over VPS presence:
 * - Outbound: immediately notifies peers when a turn starts (including tool execution)
 *   and ticks a steady 1.2s interval reading the latest streaming text from a ref
 *   (avoiding debounce starvation during fast token streams).
 * - Inbound: displays a live preview + polite "New branch" action when a teammate is
 *   streaming, and triggers a session reload when the teammate's turn finishes.
 */
export const PeerStreamBridge = ({
  workspaceId,
  conversationId,
  messages,
  loading,
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

  // Outbound: fire immediately on turn start, tick every 1.2s without resetting on tokens, clear on idle.
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

  // Inbound: reload the conversation from VPS storage once a teammate's stream completes.
  const wasPeerStreamingRef = useRef(false);
  useEffect(() => {
    const active = Boolean(streamingPeer?.chatStream);
    if (wasPeerStreamingRef.current && !active) {
      onPeerStreamFinished?.();
    }
    wasPeerStreamingRef.current = active;
  }, [streamingPeer?.chatStream, onPeerStreamFinished]);

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
