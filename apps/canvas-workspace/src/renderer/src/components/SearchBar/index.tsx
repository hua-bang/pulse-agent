import { useCallback, useEffect, useMemo, useRef } from 'react';
import './index.css';
import type { CanvasNode } from '../../types';
import type { UseCanvasSearchReturn } from '../../hooks/useCanvasSearch';

interface Props {
  search: UseCanvasSearchReturn;
  /** Lookup by id so we can render node titles/types in result rows
   *  without forcing the parent to re-pass the whole nodes array
   *  alongside the search return. */
  nodesById: Map<string, CanvasNode>;
  /** Called whenever the active match changes (open, query, next/prev).
   *  The Canvas wires this to its viewport-focus helper so the camera
   *  follows the find cursor. */
  onActivateMatch: (node: CanvasNode) => void;
}

/**
 * Ctrl/Cmd+F "find in canvas" bar.
 *
 * UX intent:
 *  - Stays open while the user pages through matches (Enter / Shift+Enter).
 *  - Shows a "3 / 12" counter so users can tell whether to keep paging
 *    or refine the query.
 *  - Results list is collapsible — most users will use just the counter
 *    + next/prev, but the list is there for cross-canvas surveying.
 *  - Esc closes and returns focus to where the user came from
 *    (handled by `useCanvasSearch.closeBar`).
 *
 * Why a separate overlay (vs. reusing CommandPalette):
 *  - The palette dismisses on Enter — incompatible with iterative find.
 *  - The bar is anchored top-center small, palette is modal large.
 *  - Different shortcuts (Ctrl+F vs Ctrl+K) and different mental models.
 */
export const SearchBar = ({ search, nodesById, onActivateMatch }: Props) => {
  const { query, setQuery, matches, activeIndex, setActiveIndex,
    activeMatch, caseSensitive, setCaseSensitive, closeBar, next, prev } = search;

  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  // When the active match changes, ask the canvas to focus it. We
  // depend on `nodeId` (not the match object reference) so a query
  // that yields a different match-for-the-same-node doesn't trigger
  // a redundant camera nudge.
  const activeNodeId = activeMatch?.nodeId ?? null;
  useEffect(() => {
    if (!activeNodeId) return;
    const node = nodesById.get(activeNodeId);
    if (node) onActivateMatch(node);
    // onActivateMatch identity is intentionally not in the deps — the
    // parent passes a fresh closure each render and we only want to
    // run when the active match itself moves.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeNodeId]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        closeBar();
        return;
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        if (e.shiftKey) prev();
        else next();
        return;
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        next();
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        prev();
        return;
      }
    },
    [closeBar, next, prev],
  );

  const counter = useMemo(() => {
    if (!query.trim()) return '';
    if (matches.length === 0) return '0 / 0';
    return `${activeIndex + 1} / ${matches.length}`;
  }, [query, activeIndex, matches.length]);

  const empty = query.trim().length > 0 && matches.length === 0;

  return (
    <div
      className="canvas-search-bar"
      // Block bubbling so clicks on the bar don't deselect nodes or
      // trigger canvas-level handlers behind it.
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      onWheel={(e) => e.stopPropagation()}
    >
      <div className="canvas-search-bar__row">
        <svg className="canvas-search-bar__icon" width="14" height="14" viewBox="0 0 16 16" fill="none">
          <circle cx="7" cy="7" r="5" stroke="currentColor" strokeWidth="1.5" />
          <path d="M11 11l3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
        <input
          ref={inputRef}
          type="text"
          className="canvas-search-bar__input"
          placeholder="Find in canvas…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          spellCheck={false}
        />
        <span className={`canvas-search-bar__counter${empty ? ' canvas-search-bar__counter--empty' : ''}`}>
          {counter}
        </span>
        <button
          type="button"
          className={`canvas-search-bar__toggle${caseSensitive ? ' is-active' : ''}`}
          title="Match case"
          aria-pressed={caseSensitive}
          onClick={() => setCaseSensitive(!caseSensitive)}
        >
          Aa
        </button>
        <button
          type="button"
          className="canvas-search-bar__nav"
          title="Previous match (Shift+Enter)"
          onClick={prev}
          disabled={matches.length === 0}
        >
          ↑
        </button>
        <button
          type="button"
          className="canvas-search-bar__nav"
          title="Next match (Enter)"
          onClick={next}
          disabled={matches.length === 0}
        >
          ↓
        </button>
        <button
          type="button"
          className="canvas-search-bar__close"
          title="Close (Esc)"
          onClick={closeBar}
        >
          ×
        </button>
      </div>

      {matches.length > 0 && (
        <div className="canvas-search-bar__results">
          {matches.slice(0, 30).map((m, idx) => {
            const node = nodesById.get(m.nodeId);
            if (!node) return null;
            const isActive = idx === activeIndex;
            return (
              <div
                key={`${m.nodeId}:${m.field}:${idx}`}
                className={`canvas-search-bar__result${isActive ? ' is-active' : ''}`}
                onClick={() => setActiveIndex(idx)}
              >
                <span className={`canvas-search-bar__badge canvas-search-bar__badge--${node.type}`}>
                  {node.type}
                </span>
                <span className="canvas-search-bar__title">{node.title || '(untitled)'}</span>
                {m.field !== 'title' && (
                  <span className="canvas-search-bar__snippet">{m.snippet}</span>
                )}
              </div>
            );
          })}
          {matches.length > 30 && (
            <div className="canvas-search-bar__overflow">
              + {matches.length - 30} more — refine the query to narrow down
            </div>
          )}
        </div>
      )}
    </div>
  );
};
