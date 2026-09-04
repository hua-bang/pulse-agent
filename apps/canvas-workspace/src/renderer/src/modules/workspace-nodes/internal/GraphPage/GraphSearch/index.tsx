import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { KnowledgeTagDefinition, WorkspaceNodeListItem } from '../../../../../types';
import { useI18n } from '../../../../../i18n';
import { isImeComposing } from '../../../../../utils/ime';
import {
  searchWorkspaceGraph,
  type WorkspaceGraphSearchResult,
} from '../../../model/graphModel';
import { getNodeTitle, getNodeWorkspaceId } from '../../utils';
import './index.css';

interface Props {
  nodes: WorkspaceNodeListItem[];
  tags: KnowledgeTagDefinition[];
  showTags: boolean;
  onPick: (result: WorkspaceGraphSearchResult) => void;
}

export const GraphSearch = ({ nodes, tags, showTags, onPick }: Props) => {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [suggestionIndex, setSuggestionIndex] = useState(0);
  const listboxId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const listboxRef = useRef<HTMLDivElement>(null);
  const suggestions = useMemo<WorkspaceGraphSearchResult[]>(
    () => searchWorkspaceGraph({ nodes, tags, query, showTags }),
    [nodes, query, showTags, tags],
  );

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      const mod = event.metaKey || event.ctrlKey;
      if (mod && event.key.toLowerCase() === 'f') {
        event.preventDefault();
        setOpen(true);
        requestAnimationFrame(() => inputRef.current?.focus());
      } else if (event.key === 'Escape' && open) {
        setOpen(false);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open]);

  useEffect(() => {
    setSuggestionIndex(0);
  }, [query]);

  useEffect(() => {
    setSuggestionIndex((index) => Math.min(index, Math.max(0, suggestions.length - 1)));
  }, [suggestions.length]);

  useEffect(() => {
    if (!query.trim()) return;
    const item = listboxRef.current?.querySelector<HTMLElement>(
      `[data-search-index="${suggestionIndex}"]`,
    );
    item?.scrollIntoView({ block: 'nearest' });
  }, [query, suggestionIndex, suggestions.length]);

  const close = () => {
    setQuery('');
    setOpen(false);
  };
  const pick = (result: WorkspaceGraphSearchResult) => {
    close();
    onPick(result);
  };
  const activeOptionId = query.trim() && suggestions[suggestionIndex]
    ? `${listboxId}-option-${suggestionIndex}`
    : undefined;

  if (!open) return null;

  return (
    <div className="workspace-graph-search">
      <div className="workspace-graph-search__row">
        <input
          ref={inputRef}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t('workspaceGraph.searchPlaceholder')}
          role="combobox"
          aria-label={t('workspaceGraph.searchLabel')}
          aria-autocomplete="list"
          aria-expanded={Boolean(query.trim())}
          aria-controls={query.trim() ? listboxId : undefined}
          aria-activedescendant={activeOptionId}
          onKeyDown={(event) => {
            if (isImeComposing(event)) return;
            if (event.key === 'Escape') {
              setOpen(false);
              return;
            }
            if (event.key === 'ArrowDown') {
              event.preventDefault();
              setSuggestionIndex((index) => Math.min(
                index + 1,
                Math.max(0, suggestions.length - 1),
              ));
            } else if (event.key === 'ArrowUp') {
              event.preventDefault();
              setSuggestionIndex((index) => Math.max(0, index - 1));
            } else if (event.key === 'Enter') {
              event.preventDefault();
              const target = suggestions[suggestionIndex];
              if (target) pick(target);
            }
          }}
        />
        <button
          type="button"
          className="workspace-node-chip"
          onClick={close}
          title={t('workspaceGraph.close')}
          aria-label={t('workspaceGraph.close')}
        >
          ✕
        </button>
      </div>
      {query.trim() && (
        <div
          ref={listboxRef}
          id={listboxId}
          className="workspace-graph-search__list"
          role="listbox"
          aria-label={t('workspaceGraph.searchResults')}
        >
          {suggestions.length === 0 ? (
            <div className="workspace-graph-search__empty">
              {t('workspaceGraph.noMatches')}
            </div>
          ) : (
            suggestions.map((result, index) => {
              const isTag = result.kind === 'tag';
              const key = result.kind === 'tag'
                ? result.graphId
                : `${getNodeWorkspaceId(result.node)}:${result.node.id}`;
              const title = result.kind === 'tag'
                ? result.label
                : getNodeTitle(result.node, t('workspaceNodes.untitled'));
              const meta = result.kind === 'tag'
                ? t('workspaceGraph.tagResult')
                : (result.node.workspaceName ?? '');
              return (
                <button
                  key={key}
                  id={`${listboxId}-option-${index}`}
                  type="button"
                  role="option"
                  aria-selected={index === suggestionIndex}
                  aria-label={t('workspaceGraph.searchOption', {
                    type: meta,
                    title: isTag ? `# ${title}` : title,
                  })}
                  data-search-index={index}
                  className={`workspace-graph-search__item${index === suggestionIndex ? ' is-active' : ''}${isTag ? ' workspace-graph-search__item--tag' : ''}`}
                  onMouseEnter={() => setSuggestionIndex(index)}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => pick(result)}
                >
                  <span className="workspace-graph-search__title">
                    {isTag ? `# ${title}` : title}
                  </span>
                  <span className="workspace-graph-search__meta">{meta}</span>
                </button>
              );
            })
          )}
        </div>
      )}
    </div>
  );
};
