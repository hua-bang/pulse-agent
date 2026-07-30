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

export const ChatTurnContext = ({
  snapshot,
}: {
  snapshot: AgentTurnContextSnapshot;
}) => {
  const { t } = useI18n();
  const executionLabel = snapshot.executionMode === 'auto'
    ? t('chat.execution.auto')
    : t('chat.execution.ask');

  return (
    <div
      className="chat-turn-context"
      role="group"
      aria-label={t('chat.turn.context')}
    >
      <dl className="chat-turn-context__meta">
        <div>
          <dt>{t('chat.turn.scope')}</dt>
          <dd>{snapshot.scopeLabel}</dd>
        </div>
        <div>
          <dt>{t('chat.turn.model')}</dt>
          <dd>{snapshot.modelLabel}</dd>
        </div>
        <div>
          <dt>{t('chat.turn.execution')}</dt>
          <dd>{executionLabel}</dd>
        </div>
      </dl>
      <ContextReferences
        label={t('chat.turn.nodes')}
        values={(snapshot.selectedNodes ?? []).map(node => node.title)}
      />
      <ContextReferences
        label={t('chat.turn.tags')}
        values={(snapshot.tags ?? []).map(tag => `#${tag.name}`)}
      />
      <ContextReferences
        label={t('chat.turn.canvases')}
        values={(snapshot.canvases ?? []).map(canvas => canvas.name)}
      />
      <ContextReferences
        label={t('chat.turn.elements')}
        values={(snapshot.domSelections ?? []).map(selection => selection.label)}
      />
      <ContextReferences
        label={t('chat.turn.tabs')}
        values={(snapshot.tabs ?? []).map(tab => tab.title)}
      />
    </div>
  );
};
