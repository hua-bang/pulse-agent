import './index.css';
import { useCallback, useId, useMemo, useRef, useState } from 'react';
import { useI18n } from '../../../../i18n';
import { Button } from '../../../../components/ui/Button';
import { Popover } from '../../../../components/ui/Popover';
import { TextField } from '../../../../components/ui/TextField';
import { CheckIcon, CloseIcon, SparklesIcon } from '../../../../components/icons';
import type { NodeTypeFilter } from '../utils';

export interface CountedFilterOption {
  id: string;
  label: string;
  count?: number;
  description?: string;
}

interface Props {
  query: string;
  onQueryChange: (query: string) => void;
  workspaces: CountedFilterOption[];
  activeWorkspaceIds: ReadonlySet<string>;
  selectedWorkspaceIds: ReadonlySet<string> | null;
  onToggleWorkspace: (workspaceId: string) => void;
  workspacesAllCount: number;
  onResetWorkspaces: () => void;
  types: Array<CountedFilterOption & { id: NodeTypeFilter }>;
  typesAllCount: number;
  typeFilter: NodeTypeFilter;
  onTypeFilterChange: (type: NodeTypeFilter) => void;
  tags: CountedFilterOption[];
  tagsAllCount: number;
  tagFilter: string | null;
  onTagFilterChange: (tag: string | null) => void;
  onClearFilters: () => void;
  /** A bounded search result or durable Workspace/Tag scope for the existing AI chat. */
  aiScopeLabel?: string;
  onAskAiAboutScope?: () => void;
}

interface FilterOptionRowProps {
  label: string;
  selected: boolean;
  selectionRole: 'menuitemcheckbox' | 'menuitemradio';
  count?: number;
  title?: string;
  onClick: () => void;
}

const FilterOptionRow = ({ label, selected, selectionRole, count, title, onClick }: FilterOptionRowProps) => (
  <Button
    size="sm"
    className={`knowledge-node-filter-option${selected ? ' is-selected' : ''}${count === 0 && !selected ? ' is-empty' : ''}`}
    role={selectionRole}
    aria-checked={selected}
    title={title}
    onClick={onClick}
  >
    <span>{label}</span>
    <span className="knowledge-node-filter-option__end">
      {count !== undefined && <span className="knowledge-node-filter-option__count">{count}</span>}
      <span className="knowledge-node-filter-option__check" aria-hidden="true">
        {selected ? <CheckIcon size={13} /> : null}
      </span>
    </span>
  </Button>
);

interface ActiveFilterProps {
  dimension: string;
  label: string;
  removeLabel: string;
  onRemove: () => void;
}

const ActiveFilter = ({ dimension, label, removeLabel, onRemove }: ActiveFilterProps) => (
  <span className="knowledge-node-active-filter">
    <span className="knowledge-node-active-filter__dimension">{dimension}</span>
    <span>{label}</span>
    <Button variant="icon" size="xs" aria-label={removeLabel} onClick={onRemove}>
      <CloseIcon size={12} />
    </Button>
  </span>
);

const SearchGlyph = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <circle cx="7" cy="7" r="4.5" stroke="currentColor" strokeWidth="1.3" />
    <path d="M10.5 10.5L14 14" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
  </svg>
);

const FilterGlyph = () => (
  <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <path d="M2.5 4h11M4.5 8h7M6.5 12h3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
  </svg>
);

export const NodeFilters = ({
  query,
  onQueryChange,
  workspaces,
  activeWorkspaceIds,
  selectedWorkspaceIds,
  onToggleWorkspace,
  workspacesAllCount,
  onResetWorkspaces,
  types,
  typesAllCount,
  typeFilter,
  onTypeFilterChange,
  tags,
  tagsAllCount,
  tagFilter,
  onTagFilterChange,
  onClearFilters,
  aiScopeLabel,
  onAskAiAboutScope,
}: Props) => {
  const { t } = useI18n();
  const panelId = useId();
  const anchorRef = useRef<HTMLSpanElement>(null);
  const [open, setOpen] = useState(false);

  const activeCount = Number(selectedWorkspaceIds !== null)
    + Number(typeFilter !== 'all')
    + Number(tagFilter !== null);

  const workspaceFilterLabel = useMemo(() => {
    if (selectedWorkspaceIds === null) return '';
    if (selectedWorkspaceIds.size === 1) {
      const id = Array.from(selectedWorkspaceIds)[0];
      return workspaces.find((workspace) => workspace.id === id)?.label ?? id;
    }
    return t('workspaceNodes.filter.workspaceSelection', {
      count: selectedWorkspaceIds.size,
      total: workspaces.length,
    });
  }, [selectedWorkspaceIds, t, workspaces]);

  const typeFilterLabel = types.find((type) => type.id === typeFilter)?.label ?? typeFilter;

  const tagFilterLabel = tagFilter
    ? tags.find((tag) => tag.id === tagFilter)?.label ?? tagFilter
    : '';

  const closePopover = useCallback((reason?: 'escape' | 'outside') => {
    setOpen(false);
    if (reason === 'escape') anchorRef.current?.querySelector('button')?.focus();
  }, []);

  return (
    <div className="knowledge-node-filters">
      <div className="knowledge-node-filter-row">
        <div className="knowledge-node-search">
          <SearchGlyph />
          <TextField
            type="search"
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            placeholder={t('workspaceNodes.searchPlaceholder')}
            aria-label={t('workspaceNodes.searchLabel')}
          />
        </div>
        <span ref={anchorRef} className="knowledge-node-filter-anchor">
          <Button
            size="md"
            className={`knowledge-node-filter-trigger${open || activeCount > 0 ? ' is-active' : ''}`}
            aria-haspopup="menu"
            aria-expanded={open}
            aria-controls={open ? panelId : undefined}
            onClick={() => setOpen((current) => !current)}
          >
            <FilterGlyph />
            <span>{t('workspaceNodes.filter.title')}</span>
            {activeCount > 0 && <span className="knowledge-node-filter-trigger__count">{activeCount}</span>}
          </Button>
        </span>
      </div>

      {activeCount > 0 && (
        <div className="knowledge-node-active-filters" aria-label={t('workspaceNodes.filter.active')}>
          {selectedWorkspaceIds !== null && (
            <ActiveFilter
              dimension={t('workspaceNodes.filter.workspaces')}
              label={workspaceFilterLabel}
              removeLabel={t('workspaceNodes.filter.remove', { filter: workspaceFilterLabel })}
              onRemove={onResetWorkspaces}
            />
          )}
          {typeFilter !== 'all' && (
            <ActiveFilter
              dimension={t('workspaceNodes.filter.types')}
              label={typeFilterLabel}
              removeLabel={t('workspaceNodes.filter.remove', { filter: typeFilterLabel })}
              onRemove={() => onTypeFilterChange('all')}
            />
          )}
          {tagFilter !== null && (
            <ActiveFilter
              dimension={t('workspaceNodes.filter.tags')}
              label={tagFilterLabel}
              removeLabel={t('workspaceNodes.filter.remove', { filter: tagFilterLabel })}
              onRemove={() => onTagFilterChange(null)}
            />
          )}
          <Button size="xs" className="knowledge-node-active-filters__clear" onClick={onClearFilters}>
            {t('workspaceNodes.filter.clearAll')}
          </Button>
        </div>
      )}

      {aiScopeLabel && onAskAiAboutScope && (
        <Button size="xs" className="knowledge-node-filter-ai-scope" onClick={onAskAiAboutScope}>
          <SparklesIcon size={12} />
          {aiScopeLabel}
        </Button>
      )}

      {open && (
        <Popover
          anchorRef={anchorRef}
          onClose={closePopover}
          placement="bottom"
          align="end"
          gap={8}
          viewportMargin={12}
          panelId={panelId}
          ariaLabel={t('workspaceNodes.filter.title')}
          className="knowledge-node-filter-popover"
        >
          <div className="knowledge-node-filter-popover__header">
            <strong>{t('workspaceNodes.filter.title')}</strong>
            <Button size="xs" role="menuitem" onClick={onClearFilters} disabled={activeCount === 0}>
              {t('workspaceNodes.filter.clear')}
            </Button>
          </div>

          {workspaces.length > 1 && (
            <section className="knowledge-node-filter-section" role="group" aria-label={t('workspaceNodes.filter.workspaces')}>
              <span className="knowledge-node-filter-section__label">{t('workspaceNodes.filter.workspaces')}</span>
              <FilterOptionRow
                label={t('workspaceNodes.allWorkspaces')}
                count={workspacesAllCount}
                selected={selectedWorkspaceIds === null}
                selectionRole="menuitemcheckbox"
                onClick={onResetWorkspaces}
              />
              {workspaces.map((workspace) => (
                <FilterOptionRow
                  key={workspace.id}
                  label={workspace.label}
                  count={workspace.count}
                  selected={activeWorkspaceIds.has(workspace.id)}
                  selectionRole="menuitemcheckbox"
                  onClick={() => onToggleWorkspace(workspace.id)}
                />
              ))}
            </section>
          )}

          <section className="knowledge-node-filter-section" role="group" aria-label={t('workspaceNodes.filter.types')}>
            <span className="knowledge-node-filter-section__label">{t('workspaceNodes.filter.types')}</span>
            <FilterOptionRow
              label={t('workspaceNodes.filter.allTypes')}
              count={typesAllCount}
              selected={typeFilter === 'all'}
              selectionRole="menuitemradio"
              onClick={() => onTypeFilterChange('all')}
            />
            {types.map((type) => (
              <FilterOptionRow
                key={type.id}
                label={type.label}
                count={type.count}
                selected={typeFilter === type.id}
                selectionRole="menuitemradio"
                onClick={() => onTypeFilterChange(type.id)}
              />
            ))}
          </section>

          {tags.length > 0 && (
            <section className="knowledge-node-filter-section" role="group" aria-label={t('workspaceNodes.filter.tags')}>
              <span className="knowledge-node-filter-section__label">{t('workspaceNodes.filter.tags')}</span>
              <FilterOptionRow
                label={t('workspaceNodes.allTags')}
                count={tagsAllCount}
                selected={tagFilter === null}
                selectionRole="menuitemradio"
                onClick={() => onTagFilterChange(null)}
              />
              {tags.map((tag) => (
                <FilterOptionRow
                  key={tag.id}
                  label={tag.label}
                  count={tag.count}
                  title={tag.description}
                  selected={tagFilter === tag.id}
                  selectionRole="menuitemradio"
                  onClick={() => onTagFilterChange(tag.id)}
                />
              ))}
            </section>
          )}
        </Popover>
      )}
    </div>
  );
};

