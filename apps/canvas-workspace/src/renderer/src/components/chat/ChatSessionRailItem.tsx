import { useState } from 'react';
import {
  CheckIcon,
  CloseIcon,
  PencilIcon,
  TrashIcon,
} from '../icons';
import { Button, TextField } from '../ui';
import { useI18n } from '../../i18n';
import { SessionTitle } from './SessionTitle';
import type { ChatSessionsRailProps, UnifiedSession } from './ChatSessionsRail';
import { sessionTitleText } from './utils/sessionTitle';

interface Props {
  session: UnifiedSession;
  onSelectSession: (session: UnifiedSession) => void;
  onRenameSession?: ChatSessionsRailProps['onRenameSession'];
  onDeleteSession?: ChatSessionsRailProps['onDeleteSession'];
  onTogglePinSession?: ChatSessionsRailProps['onTogglePinSession'];
  disabled?: boolean;
  pending?: boolean;
}

const PinIcon = ({ filled = false }: { filled?: boolean }) => (
  <svg width="14" height="14" viewBox="0 0 16 16" fill={filled ? 'currentColor' : 'none'} aria-hidden="true">
    <path
      d="M5.2 2.4h5.6l-.9 3.3 2.1 2.1v1H8.7V14L8 14.8 7.3 14V8.8H4v-1l2.1-2.1-.9-3.3Z"
      stroke="currentColor"
      strokeWidth="1.2"
      strokeLinejoin="round"
    />
  </svg>
);

export const ChatSessionRailItem = ({
  session,
  onSelectSession,
  onRenameSession,
  onDeleteSession,
  onTogglePinSession,
  disabled = false,
  pending = false,
}: Props) => {
  const { t } = useI18n();
  const title = session.preview ? sessionTitleText(session.preview) : session.date;
  const [mode, setMode] = useState<'idle' | 'rename' | 'delete'>('idle');
  const [renameValue, setRenameValue] = useState(title);
  const [busy, setBusy] = useState(false);
  const hasActions = Boolean(onRenameSession || onDeleteSession || onTogglePinSession);

  const submitRename = async () => {
    const nextTitle = renameValue.trim();
    if (!onRenameSession || !nextTitle || busy || disabled) return;
    setBusy(true);
    try {
      await onRenameSession(session, nextTitle);
      setMode('idle');
    } catch {
      // The owner reports persistence failures; keep the draft available.
    } finally {
      setBusy(false);
    }
  };

  const confirmDelete = async () => {
    if (!onDeleteSession || busy || disabled) return;
    setBusy(true);
    try {
      await onDeleteSession(session);
      setMode('idle');
    } catch {
      // The owner reports persistence failures; keep confirmation available.
    } finally {
      setBusy(false);
    }
  };

  const togglePin = async () => {
    if (!onTogglePinSession || busy || disabled) return;
    setBusy(true);
    try {
      await onTogglePinSession(session);
    } catch {
      // The owner reports persistence failures; retain the current pin state.
    } finally {
      setBusy(false);
    }
  };

  if (mode === 'rename') {
    return (
      <form
        className="chat-page-rail-item-editor"
        onSubmit={(event) => {
          event.preventDefault();
          void submitRename();
        }}
      >
        <TextField
          value={renameValue}
          onChange={(event) => setRenameValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.preventDefault();
              setMode('idle');
            }
          }}
          aria-label={t('chat.renameSession', { title })}
          autoFocus
          disabled={busy || disabled}
        />
        <Button
          variant="icon"
          size="sm"
          type="submit"
          aria-label={t('chat.saveSessionRename')}
          disabled={!renameValue.trim() || busy || disabled}
        >
          <CheckIcon size={13} />
        </Button>
        <Button
          variant="icon"
          size="sm"
          aria-label={t('chat.cancelSessionRename')}
          onClick={() => setMode('idle')}
          disabled={busy || disabled}
        >
          <CloseIcon size={13} />
        </Button>
      </form>
    );
  }

  if (mode === 'delete') {
    return (
      <div
        className="chat-page-rail-item-confirm"
        role="group"
        aria-label={t('chat.deleteSession', { title })}
      >
        <span>{t('chat.deleteSessionPrompt')}</span>
        <Button
          variant="secondary"
          size="xs"
          onClick={() => setMode('idle')}
          disabled={busy || disabled}
          aria-label={t('chat.cancelDeleteSession', { title })}
        >
          {t('chat.cancelSessionRename')}
        </Button>
        <Button
          variant="danger"
          size="xs"
          onClick={() => void confirmDelete()}
          disabled={busy || disabled}
          aria-label={t('chat.confirmDeleteSession', { title })}
        >
          {t('chat.deleteSessionAction')}
        </Button>
      </div>
    );
  }

  return (
    <div className={`chat-page-rail-item-shell${session.isPinned ? ' chat-page-rail-item-shell--pinned' : ''}`}>
      <button
        type="button"
        className={`chat-page-rail-item${session.isCurrent ? ' chat-page-rail-item--active' : ''}`}
        onClick={() => onSelectSession(session)}
        title={title}
        aria-current={session.isCurrent ? 'page' : undefined}
        aria-busy={pending ? true : undefined}
        disabled={disabled}
      >
        <span className="chat-page-rail-item-content">
          <span className="chat-page-rail-item-text">
            {session.preview ? <SessionTitle value={session.preview} /> : session.date}
          </span>
        </span>
      </button>
      {hasActions && (
        <div className="chat-page-rail-item-actions">
          {onTogglePinSession && (
            <Button
              variant="icon"
              size="sm"
              className="chat-page-rail-item-action"
              aria-label={t(session.isPinned ? 'chat.unpinSession' : 'chat.pinSession', { title })}
              aria-pressed={session.isPinned ?? false}
              onClick={() => void togglePin()}
              disabled={busy || disabled}
            >
              <PinIcon filled={session.isPinned} />
            </Button>
          )}
          {onRenameSession && (
            <Button
              variant="icon"
              size="sm"
              className="chat-page-rail-item-action"
              aria-label={t('chat.renameSession', { title })}
              onClick={() => {
                setRenameValue(title);
                setMode('rename');
              }}
              disabled={busy || disabled}
            >
              <PencilIcon size={13} />
            </Button>
          )}
          {onDeleteSession && (
            <Button
              variant="icon"
              size="sm"
              className="chat-page-rail-item-action chat-page-rail-item-action--danger"
              aria-label={t('chat.deleteSession', { title })}
              onClick={() => setMode('delete')}
              disabled={busy || disabled}
            >
              <TrashIcon size={13} />
            </Button>
          )}
        </div>
      )}
    </div>
  );
};
