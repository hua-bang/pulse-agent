import type { AgentChatMessage, AgentTurnContextSnapshot } from '../../types';
import { useI18n } from '../../i18n';
import { Button } from '../ui';

interface ChatTurnOutcomeProps {
  status?: AgentChatMessage['turnStatus'];
  errorDetails?: string;
  failureKind?: AgentChatMessage['failureKind'];
  retryable?: boolean;
  onRetry?: () => void;
}

export const ChatTurnOutcome = ({
  status,
  errorDetails,
  failureKind,
  retryable,
  onRetry,
}: ChatTurnOutcomeProps) => {
  const { t } = useI18n();
  if (!status) return null;

  const stopped = status === 'stopped';
  const statusLabel = stopped ? t('chat.turn.stopped') : t('chat.turn.failed');
  const failureDescription = failureKind
    ? t(`chat.turn.failure.${failureKind}`)
    : undefined;

  return (
    <div
      className={`chat-turn-outcome chat-turn-outcome--${status}`}
      role="group"
      aria-label={statusLabel}
    >
      <div className="chat-turn-outcome__row">
        <span className="chat-turn-outcome__status">{statusLabel}</span>
        {retryable && onRetry && (
          <Button
            size="xs"
            className="chat-turn-outcome__action"
            onClick={onRetry}
            title={stopped ? t('chat.turn.continueHint') : undefined}
          >
            {stopped ? t('chat.turn.continue') : t('chat.turn.tryAgain')}
          </Button>
        )}
      </div>
      {!stopped && failureDescription && (
        <p className="chat-turn-outcome__description">{failureDescription}</p>
      )}
      {!stopped && errorDetails && (
        <details className="chat-turn-error-details">
          <summary>{t('chat.turn.technicalDetails')}</summary>
          <pre>{errorDetails}</pre>
        </details>
      )}
    </div>
  );
};

const ContextReferences = ({
  label,
  values,
}: {
  label: string;
  values: string[];
}) => {
  if (values.length === 0) return null;
  return (
    <div className="chat-turn-context__references">
      <span className="chat-turn-context__reference-label">{label}</span>
      <span className="chat-turn-context__chips">
        {values.map((value, index) => (
          <span key={`${value}-${index}`} className="chat-turn-context__chip">{value}</span>
        ))}
      </span>
    </div>
  );
};

// Scope / model / execution are deliberately NOT shown here: all three restate
// what the composer already displays for the live turn, so every user message
// carried a row of redundant labels. Only the references — which the composer
// clears after sending and nothing else records — survive on the turn.
export const ChatTurnContext = ({
  snapshot,
}: {
  snapshot: AgentTurnContextSnapshot;
}) => {
  const { t } = useI18n();
  const references = [
    { key: 'nodes', label: t('chat.turn.nodes'), values: (snapshot.selectedNodes ?? []).map(node => node.title) },
    { key: 'tags', label: t('chat.turn.tags'), values: (snapshot.tags ?? []).map(tag => `#${tag.name}`) },
    { key: 'canvases', label: t('chat.turn.canvases'), values: (snapshot.canvases ?? []).map(canvas => canvas.name) },
    { key: 'elements', label: t('chat.turn.elements'), values: (snapshot.domSelections ?? []).map(selection => selection.label) },
    { key: 'tabs', label: t('chat.turn.tabs'), values: (snapshot.tabs ?? []).map(tab => tab.title) },
  ].filter(entry => entry.values.length > 0);

  if (references.length === 0) return null;

  return (
    <div
      className="chat-turn-context"
      role="group"
      aria-label={t('chat.turn.context')}
    >
      {references.map(entry => (
        <ContextReferences key={entry.key} label={entry.label} values={entry.values} />
      ))}
    </div>
  );
};
