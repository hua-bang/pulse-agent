import './index.css';
import { useI18n } from '../../i18n';
import type { KeyboardEvent } from 'react';

interface Props {
  selectedCount: number;
  canFocus: boolean;
  focusModeActive: boolean;
  canGroup: boolean;
  canPinReference: boolean;
  canAddToChat: boolean;
  showPinReference?: boolean;
  showAddToChat?: boolean;
  onFitSelection: () => void;
  onDuplicate: () => void;
  onToggleFocus: () => void;
  onGroup: () => void;
  onWrapFrame: () => void;
  onPinReference: () => void;
  onAddToChat: () => void;
  onDelete: () => void;
}

const ToolbarIcon = ({ kind }: { kind: 'fit' | 'duplicate' | 'focus' | 'group' | 'frame' | 'pin' | 'chat' | 'delete' }) => {
  if (kind === 'fit') {
    return (
      <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <path d="M6 2.5H3.5A1 1 0 002.5 3.5V6M10 2.5h2.5a1 1 0 011 1V6M6 13.5H3.5a1 1 0 01-1-1V10M10 13.5h2.5a1 1 0 001-1V10" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
      </svg>
    );
  }
  if (kind === 'duplicate') {
    return (
      <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <rect x="5" y="4" width="8" height="8.5" rx="1.5" stroke="currentColor" strokeWidth="1.25" />
        <path d="M3 10.5V4.2A1.7 1.7 0 014.7 2.5h6.1" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" />
      </svg>
    );
  }
  if (kind === 'focus') {
    return (
      <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <circle cx="8" cy="8" r="2.2" stroke="currentColor" strokeWidth="1.35" />
        <path d="M8 2v2.2M8 11.8V14M2 8h2.2M11.8 8H14" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" />
      </svg>
    );
  }
  if (kind === 'group') {
    return (
      <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <rect x="2.5" y="3" width="11" height="10" rx="2" stroke="currentColor" strokeWidth="1.25" strokeDasharray="2 2" />
        <path d="M5 6h6M5 10h6" stroke="currentColor" strokeWidth="1.15" strokeLinecap="round" />
      </svg>
    );
  }
  if (kind === 'frame') {
    return (
      <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <rect x="2" y="2" width="12" height="12" rx="2" stroke="currentColor" strokeWidth="1.25" />
        <rect x="4.8" y="4.8" width="6.4" height="6.4" rx="1" stroke="currentColor" strokeWidth="1" strokeDasharray="2 1.5" />
      </svg>
    );
  }
  if (kind === 'pin') {
    return (
      <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <path d="M6.4 2.8h5.1l-1.2 3.4 2.3 2.3v1.2H8.9L6.3 13.4 7 9.7H3.4V8.5l2.2-2.3L6.4 2.8z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
      </svg>
    );
  }
  if (kind === 'chat') {
    return (
      <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <path d="M3 4.5A2.5 2.5 0 015.5 2h5A2.5 2.5 0 0113 4.5v3A2.5 2.5 0 0110.5 10H8l-3.2 3v-3A2.5 2.5 0 013 7.5v-3z" stroke="currentColor" strokeWidth="1.25" strokeLinejoin="round" />
        <path d="M5.6 5.4h4.8M5.6 7.2h2.9" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" />
      </svg>
    );
  }
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M3 4.5h10" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
      <path d="M6.2 4.5V3.2h3.6v1.3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M5 6.3l.45 6.2A1.5 1.5 0 006.95 14h2.1a1.5 1.5 0 001.5-1.5L11 6.3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  );
};

const focusToolbarButton = (root: HTMLElement, direction: 1 | -1 | 'first' | 'last') => {
  const buttons = Array.from(
    root.querySelectorAll<HTMLButtonElement>('.selection-toolbar__btn:not(:disabled)'),
  );
  if (buttons.length === 0) return;

  if (direction === 'first') {
    buttons[0]?.focus();
    return;
  }
  if (direction === 'last') {
    buttons[buttons.length - 1]?.focus();
    return;
  }

  const activeButton = document.activeElement instanceof HTMLButtonElement
    ? document.activeElement
    : null;
  const currentIndex = activeButton ? buttons.indexOf(activeButton) : -1;
  const nextIndex = currentIndex === -1
    ? 0
    : (currentIndex + direction + buttons.length) % buttons.length;
  buttons[nextIndex]?.focus();
};

export const SelectionToolbar = ({
  selectedCount,
  canFocus,
  focusModeActive,
  canGroup,
  canPinReference,
  canAddToChat,
  showPinReference = false,
  showAddToChat = false,
  onFitSelection,
  onDuplicate,
  onToggleFocus,
  onGroup,
  onWrapFrame,
  onPinReference,
  onAddToChat,
  onDelete,
}: Props) => {
  const { t } = useI18n();
  if (selectedCount <= 0) return null;

  const handleToolbarKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const root = event.currentTarget;
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
      event.preventDefault();
      event.stopPropagation();
      focusToolbarButton(root, 1);
      return;
    }
    if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
      event.preventDefault();
      event.stopPropagation();
      focusToolbarButton(root, -1);
      return;
    }
    if (event.key === 'Home') {
      event.preventDefault();
      event.stopPropagation();
      focusToolbarButton(root, 'first');
      return;
    }
    if (event.key === 'End') {
      event.preventDefault();
      event.stopPropagation();
      focusToolbarButton(root, 'last');
    }
  };

  return (
    <div
      className="selection-toolbar"
      role="toolbar"
      aria-label={t('canvas.selection.toolbarLabel')}
      onMouseDown={(event) => event.stopPropagation()}
      onKeyDown={handleToolbarKeyDown}
    >
      <div className="selection-toolbar__count">
        {t('canvas.zoom.selectedChip', { count: selectedCount })}
      </div>
      <button
        type="button"
        className="selection-toolbar__btn"
        onClick={onFitSelection}
        title={t('canvas.zoom.fitSelection')}
        aria-label={t('canvas.zoom.fitSelection')}
      >
        <ToolbarIcon kind="fit" />
      </button>
      <button
        type="button"
        className="selection-toolbar__btn"
        onClick={onDuplicate}
        title={t('canvas.selection.duplicate')}
        aria-label={t('canvas.selection.duplicate')}
      >
        <ToolbarIcon kind="duplicate" />
      </button>
      <button
        type="button"
        className={`selection-toolbar__btn${focusModeActive ? ' selection-toolbar__btn--active' : ''}`}
        onClick={onToggleFocus}
        disabled={!canFocus && !focusModeActive}
        title={focusModeActive ? t('canvas.selection.exitFocus') : t('canvas.selection.focus')}
        aria-label={focusModeActive ? t('canvas.selection.exitFocus') : t('canvas.selection.focus')}
        aria-pressed={focusModeActive}
      >
        <ToolbarIcon kind="focus" />
      </button>
      <button
        type="button"
        className="selection-toolbar__btn"
        onClick={onGroup}
        disabled={!canGroup}
        title={t('canvas.selection.group')}
        aria-label={t('canvas.selection.group')}
      >
        <ToolbarIcon kind="group" />
      </button>
      <button
        type="button"
        className="selection-toolbar__btn"
        onClick={onWrapFrame}
        title={t('canvas.selection.wrapFrame')}
        aria-label={t('canvas.selection.wrapFrame')}
      >
        <ToolbarIcon kind="frame" />
      </button>
      {showPinReference && (
        <button
          type="button"
          className="selection-toolbar__btn"
          onClick={onPinReference}
          disabled={!canPinReference}
          title={t('canvas.selection.pinReference')}
          aria-label={t('canvas.selection.pinReference')}
        >
          <ToolbarIcon kind="pin" />
        </button>
      )}
      {showAddToChat && (
        <button
          type="button"
          className="selection-toolbar__btn"
          onClick={onAddToChat}
          disabled={!canAddToChat}
          title={t('canvas.selection.addToChat')}
          aria-label={t('canvas.selection.addToChat')}
        >
          <ToolbarIcon kind="chat" />
        </button>
      )}
      <button
        type="button"
        className="selection-toolbar__btn selection-toolbar__btn--danger"
        onClick={onDelete}
        title={t('canvas.selection.delete')}
        aria-label={t('canvas.selection.delete')}
      >
        <ToolbarIcon kind="delete" />
      </button>
    </div>
  );
};
