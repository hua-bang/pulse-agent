import { useCallback, useEffect, useRef, useState } from 'react';
import type { KnowledgeChangeProposal } from '../../../../shared/knowledge-change';
import { useI18n } from '../../i18n';
import { Button } from '../ui';

interface Props {
  proposal: KnowledgeChangeProposal;
}

type ApplyState = 'ready' | 'applying' | 'applied' | 'discarded' | 'conflict' | 'error';
type PersistedApplyState = Extract<ApplyState, 'applied' | 'discarded'>;

const STATUS_STORAGE_KEY = 'knowledge-change-proposals:status:v1';

function readStatuses(): Record<string, PersistedApplyState> {
  if (typeof window === 'undefined') return {};
  try {
    const parsed: unknown = JSON.parse(window.localStorage?.getItem(STATUS_STORAGE_KEY) ?? '{}');
    if (!parsed || typeof parsed !== 'object') return {};
    return Object.fromEntries(Object.entries(parsed).filter((entry): entry is [string, PersistedApplyState] => (
      entry[1] === 'applied' || entry[1] === 'discarded'
    )));
  } catch {
    return {};
  }
}

function readPersistedState(proposalId: string): ApplyState {
  return readStatuses()[proposalId] ?? 'ready';
}

function persistState(proposalId: string, state: PersistedApplyState | null): void {
  if (typeof window === 'undefined') return;
  try {
    const statuses = readStatuses();
    delete statuses[proposalId];
    if (state) statuses[proposalId] = state;
    const capped = Object.fromEntries(Object.entries(statuses).slice(-200));
    window.localStorage?.setItem(STATUS_STORAGE_KEY, JSON.stringify(capped));
  } catch {
    // Private mode or quota failures only affect remembered presentation.
  }
}

function preview(value: string | undefined): string {
  if (!value) return '∅';
  const compact = value.replace(/\s+/g, ' ').trim();
  return compact.length > 420 ? `${compact.slice(0, 419)}…` : compact;
}

const DiffRow = ({
  label,
  before,
  after,
  beforeLabel,
  afterLabel,
  fullReviewLabel,
}: {
  label: string;
  before: string | undefined;
  after: string | undefined;
  beforeLabel: string;
  afterLabel: string;
  fullReviewLabel: string;
}) => (
  <div className="knowledge-change-card__diff-row">
    <div className="knowledge-change-card__field-label">{label}</div>
    <div className="knowledge-change-card__compare">
      <div className="knowledge-change-card__value knowledge-change-card__value--before" role="group" aria-label={beforeLabel}>
        <span className="knowledge-change-card__comparison-label" aria-hidden="true">{beforeLabel}</span>
        <p>{preview(before)}</p>
      </div>
      <div className="knowledge-change-card__value knowledge-change-card__value--after" role="group" aria-label={afterLabel}>
        <span className="knowledge-change-card__comparison-label" aria-hidden="true">{afterLabel}</span>
        <p>{preview(after)}</p>
      </div>
    </div>
    {Math.max(before?.length ?? 0, after?.length ?? 0) > 420 && (
      <details className="knowledge-change-card__full-review">
        <summary>{fullReviewLabel}</summary>
        <div className="knowledge-change-card__compare">
          <pre className="knowledge-change-card__value knowledge-change-card__value--before" aria-label={beforeLabel}>{before || '∅'}</pre>
          <pre className="knowledge-change-card__value knowledge-change-card__value--after" aria-label={afterLabel}>{after || '∅'}</pre>
        </div>
      </details>
    )}
  </div>
);

const TagsDiff = ({
  before,
  after,
  beforeLabel,
  afterLabel,
}: {
  before: string[];
  after: string[];
  beforeLabel: string;
  afterLabel: string;
}) => (
  <div className="knowledge-change-card__compare">
    <div className="knowledge-change-card__value knowledge-change-card__value--before" role="group" aria-label={beforeLabel}>
      <span className="knowledge-change-card__comparison-label" aria-hidden="true">{beforeLabel}</span>
      <div className="knowledge-change-card__tags">
        {before.length > 0 ? before.map((tag) => <span key={tag}>{tag}</span>) : <p>∅</p>}
      </div>
    </div>
    <div className="knowledge-change-card__value knowledge-change-card__value--after" role="group" aria-label={afterLabel}>
      <span className="knowledge-change-card__comparison-label" aria-hidden="true">{afterLabel}</span>
      <div className="knowledge-change-card__tags">
        {after.length > 0 ? after.map((tag) => <span key={tag}>{tag}</span>) : <p>∅</p>}
      </div>
    </div>
  </div>
);

export const KnowledgeChangeProposalCard = ({ proposal }: Props) => {
  const { t } = useI18n();
  const [state, setState] = useState<ApplyState>(() => readPersistedState(proposal.proposalId));
  const [error, setError] = useState('');
  const statusRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (state !== 'ready') statusRef.current?.focus();
  }, [state]);

  const apply = useCallback(async () => {
    const api = window.canvasWorkspace?.workspaceNodes;
    if (!api?.applyProposal || state !== 'ready') return;
    setState('applying');
    setError('');
    try {
      const result = await api.applyProposal(proposal);
      if (result.ok) {
        persistState(proposal.proposalId, 'applied');
        setState('applied');
        return;
      }
      setError(result.error);
      setState(result.code === 'conflict' ? 'conflict' : 'error');
    } catch (applyError) {
      setError(applyError instanceof Error ? applyError.message : String(applyError));
      setState('error');
    }
  }, [proposal, state]);

  const retry = useCallback(() => {
    persistState(proposal.proposalId, null);
    setError('');
    setState('ready');
  }, [proposal.proposalId]);

  const discard = useCallback(() => {
    persistState(proposal.proposalId, 'discarded');
    setState('discarded');
  }, [proposal.proposalId]);

  const { before, patch } = proposal;
  return (
    <section className={`knowledge-change-card knowledge-change-card--${state}`}>
      <header className="knowledge-change-card__header">
        <span className="knowledge-change-card__spark" aria-hidden="true">✦</span>
        <div>
          <div className="knowledge-change-card__eyebrow">{t('knowledgeChange.proposal')}</div>
          <h4>{proposal.target.nodeTitle}</h4>
          <div className="knowledge-change-card__workspace">
            {proposal.target.workspaceName ?? proposal.target.workspaceId}
          </div>
        </div>
        <span className="knowledge-change-card__type">{proposal.target.nodeType}</span>
      </header>
      <p className="knowledge-change-card__summary">{proposal.summary}</p>

      {state !== 'discarded' && (
        <div className="knowledge-change-card__diffs">
          {patch.aiSummary !== undefined && (
            <DiffRow label={t('knowledgeChange.aiSummary')} before={before.aiSummary} after={patch.aiSummary}
              beforeLabel={t('knowledgeChange.before')} afterLabel={t('knowledgeChange.after')}
              fullReviewLabel={t('knowledgeChange.reviewFull')} />
          )}
          {patch.title !== undefined && (
            <DiffRow label={t('knowledgeChange.title')} before={before.title} after={patch.title}
              beforeLabel={t('knowledgeChange.before')} afterLabel={t('knowledgeChange.after')}
              fullReviewLabel={t('knowledgeChange.reviewFull')} />
          )}
          {patch.content !== undefined && (
            <DiffRow label={t('knowledgeChange.content')} before={before.content} after={patch.content}
              beforeLabel={t('knowledgeChange.before')} afterLabel={t('knowledgeChange.after')}
              fullReviewLabel={t('knowledgeChange.reviewFull')} />
          )}
          {patch.tags !== undefined && (
            <div className="knowledge-change-card__diff-row">
              <div className="knowledge-change-card__field-label">{t('knowledgeChange.tags')}</div>
              <TagsDiff before={before.tags ?? []} after={patch.tags}
                beforeLabel={t('knowledgeChange.before')} afterLabel={t('knowledgeChange.after')} />
            </div>
          )}
        </div>
      )}

      {(state === 'conflict' || state === 'error') && (
        <p className="knowledge-change-card__error" role="alert">
          {state === 'conflict' ? t('knowledgeChange.conflict') : error || t('knowledgeChange.failed')}
        </p>
      )}

      <footer
        ref={statusRef}
        className="knowledge-change-card__actions"
        aria-live="polite"
        tabIndex={state === 'ready' ? undefined : -1}
      >
        {state === 'ready' && (
          <>
            <Button size="sm" onClick={discard}>
              {t('knowledgeChange.discard')}
            </Button>
            <Button size="sm" variant="primary" className="knowledge-change-card__apply" onClick={() => void apply()}>
              {t('knowledgeChange.apply')}
            </Button>
          </>
        )}
        {state === 'applying' && <span role="status">{t('knowledgeChange.applying')}</span>}
        {state === 'applied' && <span role="status" className="knowledge-change-card__success">✓ {t('knowledgeChange.applied')}</span>}
        {state === 'discarded' && (
          <>
            <span>{t('knowledgeChange.discarded')}</span>
            <Button size="sm" onClick={retry}>{t('knowledgeChange.reviewAgain')}</Button>
          </>
        )}
        {state === 'error' && <Button size="sm" onClick={retry}>{t('knowledgeChange.tryAgain')}</Button>}
        {state === 'conflict' && <Button size="sm" onClick={discard}>{t('knowledgeChange.discard')}</Button>}
      </footer>
    </section>
  );
};
