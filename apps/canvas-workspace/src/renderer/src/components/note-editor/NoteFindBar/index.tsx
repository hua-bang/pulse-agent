import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import './index.css';
import type { Editor } from '@tiptap/react';
import {
  clearNoteSearch,
  DEFAULT_SEARCH_OPTIONS,
  getNoteSearchState,
  navigateNoteSearch,
  replaceAllMatches,
  replaceCurrentMatch,
  setNoteSearch,
  type NoteSearchOptions,
} from '../../../editor/noteSearchExtension';
import { useI18n } from '../../../i18n';
import { isImeComposing } from '../../../utils/ime';

interface Props {
  editor: Editor;
  onClose: () => void;
}

export const NoteFindBar = ({ editor, onClose }: Props) => {
  const { t } = useI18n();
  const [query, setQuery] = useState('');
  const [replacement, setReplacement] = useState('');
  const [showReplace, setShowReplace] = useState(false);
  const [options, setOptions] = useState<NoteSearchOptions>(DEFAULT_SEARCH_OPTIONS);
  const inputRef = useRef<HTMLInputElement>(null);
  const subscribeToSearchState = useCallback((onStoreChange: () => void) => {
    const handleTransaction = () => onStoreChange();
    editor.on('transaction', handleTransaction);
    return () => editor.off('transaction', handleTransaction);
  }, [editor]);
  const getSearchStateSnapshot = useCallback(
    () => getNoteSearchState(editor.state),
    [editor],
  );
  const state = useSyncExternalStore(
    subscribeToSearchState,
    getSearchStateSnapshot,
    getSearchStateSnapshot,
  );
  const total = state?.matches.length ?? 0;
  const current = state?.matches.length ? state.current + 1 : 0;
  const invalid = state?.invalid ?? false;

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  // Clear search decorations when the bar closes
  useEffect(() => {
    return () => clearNoteSearch(editor.view);
  }, [editor]);

  const runSearch = (q: string) => {
    setQuery(q);
    setNoteSearch(editor.view, q, options);
  };

  const toggleOption = (key: keyof NoteSearchOptions) => {
    const next = { ...options, [key]: !options[key] };
    setOptions(next);
    setNoteSearch(editor.view, query, next);
  };

  const closeAndRestoreFocus = () => {
    onClose();
    requestAnimationFrame(() => editor.commands.focus());
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (isImeComposing(e)) return;
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'f') {
      e.preventDefault();
      inputRef.current?.focus();
      inputRef.current?.select();
      return;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      closeAndRestoreFocus();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (e.shiftKey) navigateNoteSearch(editor.view, -1);
      else navigateNoteSearch(editor.view, 1);
    }
  };

  return (
    <div
      className="note-find-bar"
      role="search"
      aria-label={t('noteFind.label')}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div className="note-find-row">
        <button
          type="button"
          className="note-find-toggle"
          onClick={() => setShowReplace((v) => !v)}
          aria-expanded={showReplace}
          aria-label={t(showReplace ? 'noteFind.hideReplace' : 'noteFind.showReplace')}
          title={t(showReplace ? 'noteFind.hideReplace' : 'noteFind.showReplace')}
        >
          {showReplace ? '▾' : '▸'}
        </button>
        <input
          ref={inputRef}
          className={`note-find-input${invalid ? ' note-find-input--invalid' : ''}`}
          placeholder={t('noteFind.findPlaceholder')}
          aria-label={t('noteFind.findPlaceholder')}
          aria-invalid={invalid}
          value={query}
          onChange={(e) => runSearch(e.target.value)}
          onKeyDown={handleKeyDown}
        />
        <div className="note-find-toggles" role="group" aria-label={t('noteFind.options')}>
          <button
            type="button"
            className={`note-find-opt${options.caseSensitive ? ' note-find-opt--on' : ''}`}
            aria-pressed={options.caseSensitive}
            aria-label={t('noteFind.matchCase')}
            title={t('noteFind.matchCase')}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => toggleOption('caseSensitive')}
          >
            Aa
          </button>
          <button
            type="button"
            className={`note-find-opt${options.wholeWord ? ' note-find-opt--on' : ''}`}
            aria-pressed={options.wholeWord}
            aria-label={t('noteFind.wholeWord')}
            title={t('noteFind.wholeWord')}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => toggleOption('wholeWord')}
          >
            W
          </button>
          <button
            type="button"
            className={`note-find-opt${options.regex ? ' note-find-opt--on' : ''}`}
            aria-pressed={options.regex}
            aria-label={t('noteFind.regex')}
            title={t('noteFind.regex')}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => toggleOption('regex')}
          >
            .*
          </button>
        </div>
        <span
          className="note-find-count"
          aria-live="polite"
          title={invalid ? t('noteFind.invalidRegex') : undefined}
        >
          {invalid ? '!' : total > 0 ? `${current}/${total}` : query ? '0/0' : ''}
        </span>
        <button
          type="button"
          className="note-find-nav"
          onClick={() => navigateNoteSearch(editor.view, -1)}
          disabled={total === 0}
          aria-label={t('noteFind.previous')}
          title={t('noteFind.previous')}
        >
          ‹
        </button>
        <button
          type="button"
          className="note-find-nav"
          onClick={() => navigateNoteSearch(editor.view, 1)}
          disabled={total === 0}
          aria-label={t('noteFind.next')}
          title={t('noteFind.next')}
        >
          ›
        </button>
        <button
          type="button"
          className="note-find-close"
          onClick={closeAndRestoreFocus}
          aria-label={t('noteFind.close')}
          title={t('noteFind.close')}
        >
          ×
        </button>
      </div>
      {showReplace && (
        <div className="note-find-row">
          <span className="note-find-toggle note-find-toggle--spacer" />
          <input
            className="note-find-input"
            placeholder={t('noteFind.replacePlaceholder')}
            aria-label={t('noteFind.replacePlaceholder')}
            value={replacement}
            onChange={(e) => setReplacement(e.target.value)}
            onKeyDown={(e) => {
              if (isImeComposing(e)) return;
              if (e.key === 'Escape') {
                e.preventDefault();
                closeAndRestoreFocus();
              } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'f') {
                e.preventDefault();
                inputRef.current?.focus();
                inputRef.current?.select();
              } else if (e.key === 'Enter') {
                e.preventDefault();
                if (total > 0) replaceCurrentMatch(editor.view, replacement);
              }
            }}
          />
          <button
            type="button"
            className="note-find-action"
            onClick={() => replaceCurrentMatch(editor.view, replacement)}
            disabled={total === 0}
          >
            {t('noteFind.replace')}
          </button>
          <button
            type="button"
            className="note-find-action"
            onClick={() => replaceAllMatches(editor.view, replacement)}
            disabled={total === 0}
          >
            {t('noteFind.replaceAll')}
          </button>
        </div>
      )}
    </div>
  );
};
