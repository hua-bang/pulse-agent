import './index.css';
import { useState, type ReactNode } from 'react';
import { useI18n } from '../../../../i18n';
import { Button } from '../../../../components/ui/Button';
import { TextField } from '../../../../components/ui/TextField';
import { SparklesIcon } from '../../../../components/icons';
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

/** Tags shown before the row collapses the rest behind a "+N" toggle. */
const VISIBLE_TAG_LIMIT = 8;

interface FacetChipProps {
  label: string;
  count?: number;
  pressed: boolean;
  title?: string;
  onClick: () => void;
}

const FacetChip = ({ label, count, pressed, title, onClick }: FacetChipProps) => (
  <Button
    size="xs"
    className={`knowledge-node-facet-chip${pressed ? ' is-selected' : ''}${count === 0 && !pressed ? ' is-empty' : ''}`}
    aria-pressed={pressed}
    title={title}
    onClick={onClick}
  >
    <span>{label}</span>
    {count !== undefined && <span className="knowledge-node-facet-chip__count">{count}</span>}
  </Button>
);

interface FacetRowProps {
  label: string;
  children: ReactNode;
}

const FacetRow = ({ label, children }: FacetRowProps) => (
  <div className="knowledge-node-facet-row" role="group" aria-label={label}>
    <span className="knowledge-node-facet-row__label">{label}</span>
    <div className="knowledge-node-facet-row__chips">{children}</div>
  </div>
);

const SearchGlyph = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <circle cx="7" cy="7" r="4.5" stroke="currentColor" strokeWidth="1.3" />
    <path d="M10.5 10.5L14 14" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
  </svg>
);

export const NodeFilters = ({
  query,
  onQueryChange,
  workspaces,
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
  const [tagsExpanded, setTagsExpanded] = useState(false);

  const hasActiveFilters = selectedWorkspaceIds !== null
    || typeFilter !== 'all'
    || tagFilter !== null;

  // Keep the selected tag visible even when it falls past the collapsed limit.
  const visibleTags = tagsExpanded
    ? tags
    : tags.filter((tag, index) => index < VISIBLE_TAG_LIMIT || tag.id === tagFilter);
  const hiddenTagCount = tags.length - visibleTags.length;

  return (
    <div className="knowledge-node-filters">
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

      <div className="knowledge-node-facets">
        {workspaces.length > 1 && (
          <FacetRow label={t('workspaceNodes.filter.workspaces')}>
            <FacetChip
              label={t('workspaceNodes.filter.all')}
              count={workspacesAllCount}
              pressed={selectedWorkspaceIds === null}
              onClick={onResetWorkspaces}
            />
            {workspaces.map((workspace) => (
              <FacetChip
                key={workspace.id}
                label={workspace.label}
                count={workspace.count}
                pressed={selectedWorkspaceIds?.has(workspace.id) ?? false}
                onClick={() => onToggleWorkspace(workspace.id)}
              />
            ))}
          </FacetRow>
        )}

        <FacetRow label={t('workspaceNodes.filter.types')}>
          <FacetChip
            label={t('workspaceNodes.filter.all')}
            count={typesAllCount}
            pressed={typeFilter === 'all'}
            onClick={() => onTypeFilterChange('all')}
          />
          {types.map((type) => (
            <FacetChip
              key={type.id}
              label={type.label}
              count={type.count}
              pressed={typeFilter === type.id}
              onClick={() => onTypeFilterChange(typeFilter === type.id ? 'all' : type.id)}
            />
          ))}
        </FacetRow>

        {tags.length > 0 && (
          <FacetRow label={t('workspaceNodes.filter.tags')}>
            <FacetChip
              label={t('workspaceNodes.filter.all')}
              count={tagsAllCount}
              pressed={tagFilter === null}
              onClick={() => onTagFilterChange(null)}
            />
            {visibleTags.map((tag) => (
              <FacetChip
                key={tag.id}
                label={tag.label}
                count={tag.count}
                title={tag.description}
                pressed={tagFilter === tag.id}
                onClick={() => onTagFilterChange(tagFilter === tag.id ? null : tag.id)}
              />
            ))}
            {(hiddenTagCount > 0 || tagsExpanded) && tags.length > VISIBLE_TAG_LIMIT && (
              <Button
                size="xs"
                className="knowledge-node-facet-more"
                aria-expanded={tagsExpanded}
                onClick={() => setTagsExpanded((current) => !current)}
              >
                {tagsExpanded ? t('workspaceNodes.filter.less') : `+${hiddenTagCount}`}
              </Button>
            )}
          </FacetRow>
        )}
      </div>

      {(hasActiveFilters || (aiScopeLabel && onAskAiAboutScope)) && (
        <div className="knowledge-node-filter-actions">
          {hasActiveFilters && (
            <Button size="xs" className="knowledge-node-filter-clear" onClick={onClearFilters}>
              {t('workspaceNodes.filter.clearAll')}
            </Button>
          )}
          {aiScopeLabel && onAskAiAboutScope && (
            <Button size="xs" className="knowledge-node-filter-ai-scope" onClick={onAskAiAboutScope}>
              <SparklesIcon size={12} />
              {aiScopeLabel}
            </Button>
          )}
        </div>
      )}
    </div>
  );
};
