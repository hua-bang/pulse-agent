import { useMemo, useState } from 'react';
import type { AgentContextDomReviewComment, AgentContextDomSelectionRef } from '../../../../../types';
import { Button } from '../../../../../components/ui/Button';
import { useI18n } from '../../../../../i18n';

interface IframeReviewLayerProps {
  comments: AgentContextDomReviewComment[];
  draftSelection: AgentContextDomSelectionRef | null;
  draftText: string;
  sending: boolean;
  onDraftTextChange: (value: string) => void;
  onSaveDraft: () => void;
  onCancelDraft: () => void;
  onUpdateComment: (id: string, text: string) => void;
  onRemoveComment: (id: string) => void;
  onSubmit: () => void;
  onClear: () => void;
}

const PIN_SIZE = 22;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function rectStyle(selection: AgentContextDomSelectionRef) {
  const rect = selection.rect;
  if (!rect) return undefined;
  return {
    left: `${Math.max(0, rect.x)}px`,
    top: `${Math.max(0, rect.y)}px`,
    width: `${Math.max(1, rect.width)}px`,
    height: `${Math.max(1, rect.height)}px`,
  };
}

function popoverStyle(selection: AgentContextDomSelectionRef) {
  const rect = selection.rect;
  if (!rect) return { left: 12, top: 12 };
  return {
    left: clamp(rect.x + rect.width + 10, 10, 520),
    top: Math.max(10, rect.y),
  };
}

function pinStyle(selection: AgentContextDomSelectionRef) {
  const rect = selection.rect;
  if (!rect) return { left: 12, top: 12 };
  return {
    left: `${Math.max(8, rect.x + Math.min(rect.width, 10) - PIN_SIZE / 2)}px`,
    top: `${Math.max(8, rect.y - PIN_SIZE / 2)}px`,
  };
}

export function IframeReviewLayer({
  comments,
  draftSelection,
  draftText,
  sending,
  onDraftTextChange,
  onSaveDraft,
  onCancelDraft,
  onUpdateComment,
  onRemoveComment,
  onSubmit,
  onClear,
}: IframeReviewLayerProps) {
  const { t } = useI18n();
  const [activeId, setActiveId] = useState<string | null>(null);
  const activeComment = useMemo(
    () => comments.find((comment) => comment.id === activeId) ?? null,
    [activeId, comments],
  );
  const canSubmit = comments.some((comment) => comment.text.trim());

  return (
    <div className="iframe-review-layer" aria-live="polite">
      {comments.map((comment, index) => (
        <button
          key={comment.id}
          type="button"
          className={`iframe-review-pin${activeId === comment.id ? ' iframe-review-pin--active' : ''}`}
          style={pinStyle(comment.selection)}
          onClick={() => setActiveId((current) => (current === comment.id ? null : comment.id))}
          title={t('iframe.review.pin', { index: index + 1, label: comment.selection.label })}
        >
          {index + 1}
        </button>
      ))}

      {activeComment && (
        <div className="iframe-review-popover" style={popoverStyle(activeComment.selection)}>
          <div className="iframe-review-popover__label">{activeComment.selection.label}</div>
          <textarea
            className="iframe-review-textarea"
            value={activeComment.text}
            onChange={(event) => onUpdateComment(activeComment.id, event.target.value)}
            rows={3}
          />
          <div className="iframe-review-popover__actions">
            <Button type="button" variant="secondary" size="xs" onClick={() => setActiveId(null)}>{t('iframe.review.close')}</Button>
            <Button type="button" variant="danger" size="xs" onClick={() => onRemoveComment(activeComment.id)}>{t('iframe.review.delete')}</Button>
          </div>
        </div>
      )}

      {draftSelection && (
        <>
          {draftSelection.rect && <div className="iframe-review-selection" style={rectStyle(draftSelection)} />}
          <div className="iframe-review-popover iframe-review-popover--draft" style={popoverStyle(draftSelection)}>
            <div className="iframe-review-popover__label">{draftSelection.label}</div>
            <textarea
              className="iframe-review-textarea"
              autoFocus
              value={draftText}
              onChange={(event) => onDraftTextChange(event.target.value)}
              onKeyDown={(event) => {
                if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') onSaveDraft();
                if (event.key === 'Escape') onCancelDraft();
              }}
              placeholder={t('iframe.review.placeholder')}
              rows={3}
            />
            <div className="iframe-review-popover__actions">
              <Button type="button" variant="secondary" size="xs" onClick={onCancelDraft}>{t('iframe.review.cancel')}</Button>
              <Button type="button" variant="primary" size="xs" onClick={onSaveDraft} disabled={!draftText.trim()}>
                {t('iframe.review.add')}
              </Button>
            </div>
          </div>
        </>
      )}

      {comments.length > 0 && (
        <div className="iframe-review-pending-bar">
          <span>
            {comments.length === 1
              ? t('iframe.review.countOne')
              : t('iframe.review.countMany', { count: comments.length })}
          </span>
          <Button type="button" variant="danger" size="xs" onClick={onClear} disabled={sending}>{t('iframe.review.clear')}</Button>
          <Button type="button" variant="primary" size="xs" onClick={onSubmit} disabled={!canSubmit || sending}>
            {t(sending ? 'iframe.review.sending' : 'iframe.review.send')}
          </Button>
        </div>
      )}
    </div>
  );
}
