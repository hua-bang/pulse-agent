import { Button } from '../../../../components/ui/Button';
import { useI18n } from '../../../../i18n';
import './PeerStreamBridge.css';

interface Props {
  active: boolean;
  typingPeers: readonly string[];
  noteOnly: boolean;
  onToggleNoteOnly: () => void;
}

/**
 * Compact 1-line strip rendered directly above the composer on shared VPS workspaces:
 * shows live teammate typing status on the left and a "Teammates only (skip Agent)"
 * toggle on the right. Renders nothing on local canvases.
 */
export const SharedChatRoomBar = ({
  active,
  typingPeers,
  noteOnly,
  onToggleNoteOnly,
}: Props) => {
  const { t } = useI18n();
  if (!active) return null;

  return (
    <div className="chat-room-bar">
      <span className="chat-room-bar__typing" role="status" aria-live="polite">
        {typingPeers.length > 0 && (
          <>
            <span className="chat-room-bar__typing-dot" aria-hidden="true" />
            <span>{t('chatRoom.typing', { names: typingPeers.join(', ') })}</span>
          </>
        )}
      </span>
      <Button
        size="sm"
        variant={noteOnly ? 'primary' : 'secondary'}
        onClick={onToggleNoteOnly}
        title={t('chatRoom.noteOnlyTitle')}
        aria-pressed={noteOnly}
      >
        {t('chatRoom.noteOnly')}
      </Button>
    </div>
  );
};
