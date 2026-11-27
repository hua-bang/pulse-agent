import { useI18n } from '../../../../i18n';
import './PeerStreamBridge.css';

interface Props {
  active: boolean;
  typingPeers: readonly string[];
  noteOnly: boolean;
  onToggleNoteOnly: () => void;
}

/**
 * Compact 1-line strip rendered directly above the composer on shared VPS workspaces
 * when a teammate is actively typing. Renders nothing when idle or on local canvases.
 */
export const SharedChatRoomBar = ({
  active,
  typingPeers,
}: Props) => {
  const { t } = useI18n();
  if (!active || typingPeers.length === 0) return null;

  return (
    <div className="chat-room-bar">
      <span className="chat-room-bar__typing" role="status" aria-live="polite">
        <span className="chat-room-bar__typing-dot" aria-hidden="true" />
        <span>{t('chatRoom.typing', { names: typingPeers.join(', ') })}</span>
      </span>
    </div>
  );
};
