import { useI18n } from '../../../i18n';

/**
 * Placeholder rows the loading thread is built from. Alternating user /
 * assistant turns with per-row line widths, so the block reads as a
 * conversation instead of a stack of identical bars. Assistant rows carry an
 * avatar box because only assistant messages render one (see ChatMessage).
 */
const SKELETON_ROWS: ReadonlyArray<{ role: 'user' | 'assistant'; lines: readonly string[] }> = [
  { role: 'user', lines: ['58%'] },
  { role: 'assistant', lines: ['94%', '82%', '47%'] },
  { role: 'user', lines: ['36%'] },
  { role: 'assistant', lines: ['88%', '61%'] },
];

/**
 * Session-detail loading state: shown in place of the message thread while a
 * conversation's messages are being fetched (rail pick, session-ref chip jump,
 * back bar, scope switch). Deliberately reuses the real `.chat-message` row
 * classes so the placeholder sits on the same geometry the real bubbles land
 * on and the thread doesn't jump when they arrive.
 */
export const ChatThreadSkeleton = () => {
  const { t } = useI18n();

  return (
    <div
      className="chat-thread-skeleton"
      role="status"
      aria-live="polite"
      aria-label={t('chat.loadingSession')}
    >
      {SKELETON_ROWS.map((row, rowIndex) => (
        <div
          key={rowIndex}
          className={`chat-message chat-message-${row.role} chat-skeleton-row`}
          aria-hidden="true"
        >
          {row.role === 'assistant' && (
            <div className="chat-message-avatar chat-skeleton-avatar" />
          )}
          <div className="chat-message-body chat-skeleton-body">
            {row.lines.map((width, lineIndex) => (
              <div key={lineIndex} className="chat-skeleton-line" style={{ width }} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
};
