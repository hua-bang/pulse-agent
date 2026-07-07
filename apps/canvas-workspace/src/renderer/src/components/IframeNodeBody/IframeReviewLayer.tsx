import { useMemo, useState } from 'react';
import type { AgentContextDomReviewComment, AgentContextDomSelectionRef } from '../../types';

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
          title={`Review ${index + 1}: ${comment.selection.label}`}
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
            <button type="button" className="iframe-review-mini-btn" onClick={() => setActiveId(null)}>Close</button>
            <button type="button" className="iframe-review-mini-btn" onClick={() => onRemoveComment(activeComment.id)}>Delete</button>
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
              placeholder="Describe the change for this element"
              rows={3}
            />
            <div className="iframe-review-popover__actions">
              <button type="button" className="iframe-review-mini-btn" onClick={onCancelDraft}>Cancel</button>
              <button type="button" className="iframe-review-mini-btn iframe-review-mini-btn--primary" onClick={onSaveDraft} disabled={!draftText.trim()}>
                Add
              </button>
            </div>
          </div>
        </>
      )}

      {comments.length > 0 && (
        <div className="iframe-review-pending-bar">
          <span>{comments.length} review comment{comments.length === 1 ? '' : 's'}</span>
          <button type="button" className="iframe-review-mini-btn" onClick={onClear} disabled={sending}>Clear</button>
          <button type="button" className="iframe-review-mini-btn iframe-review-mini-btn--primary" onClick={onSubmit} disabled={!canSubmit || sending}>
            {sending ? 'Sending...' : 'Send to Chat'}
          </button>
        </div>
      )}
    </div>
  );
}
