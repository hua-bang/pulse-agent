import { useRef } from 'react';
import type { WorkspaceEntry } from '../../../../shared/workspaces';
import type { WorkspaceNodeListItem } from '../../../../types';
import { RefreshIcon, SparklesIcon } from '../../../../components/icons';
import { Button } from '../../../../components/ui/Button';
import { useI18n } from '../../../../i18n';
import { dispatchOpenNodePage } from '../../../../utils/openNodeBridge';
import { KnowledgeNodeCard } from '../KnowledgeNodeCard';
import { KnowledgeViewTabs } from '../KnowledgeViewTabs';
import { NodeFilters } from '../NodeFilters';
import type { NodesAiContext } from '../knowledgeAiContext';
import {
  formatTime,
  getNodeTags,
  getNodeTitle,
  getNodeTypeLabel,
  getNodeWorkspaceId,
  isKnowledgeNodeType,
} from '../utils';
import { distributeIntoColumns, useMasonryColumns } from './useMasonryColumns';
import { useNodesPageController } from './useNodesPageController';
// Shared Knowledge page tokens and layout; this page can open before any detail panel loads them.
import '../index.css';
import './index.css';

interface NodesPageProps {
  workspaces: WorkspaceEntry[];
  onAskAi?: (context: NodesAiContext, action: 'chat' | 'summarize') => void;
  /** Switch to the graph view; omitted when the graph is unavailable. */
  onOpenGraph?: () => void;
}

export const NodesPage = ({ workspaces, onAskAi, onOpenGraph }: NodesPageProps) => {
  const { t } = useI18n();
  const controller = useNodesPageController({
    workspaces,
    aiEnabled: Boolean(onAskAi),
  });
  const gridRef = useRef<HTMLDivElement | null>(null);
  const columns = useMasonryColumns(gridRef);
  const isFiltering = controller.hasActiveFilters || controller.query.trim().length > 0;
  // Search or filters hid every node; the migration hint would wrongly suggest there are none.
  const noMatches = isFiltering && controller.nodesCount > 0;

  const renderCard = (node: WorkspaceNodeListItem) => {
    const tags = getNodeTags(node);
    const workspaceId = getNodeWorkspaceId(node);
    const title = getNodeTitle(node, t('workspaceNodes.untitled'));
    const nodeContext = controller.nodeContext(node);
    const contextSelected = controller.isContextSelected(node);
    return (
      <KnowledgeNodeCard
        key={`${workspaceId}:${node.id}`}
        node={node}
        title={title}
        typeLabel={getNodeTypeLabel(
          node.type,
          t,
          t('workspaceNodes.genericNode'),
        )}
        updatedLabel={formatTime(
          node.updatedAt,
          t('workspaceNodes.noTimestamp'),
          controller.dateLocale,
        )}
        tagLabels={tags.map(controller.tagLabel)}
        contextLabel={node.workspaceName ?? workspaceId}
        aiSummaryLabel={t('workspaceNodes.aiSummary')}
        aiSummaryConfirmedLabel={t('workspaceNodes.aiSummaryConfirmed')}
        aiSummarizeLabel={t('workspaceNodes.aiSummarize')}
        aiChatLabel={t('workspaceNodes.aiChat')}
        selectForAiLabel={t('workspaceNodes.selectForAi')}
        deselectForAiLabel={t('workspaceNodes.deselectForAi')}
        openLabel={t('workspaceNodes.openNodeTab', { title })}
        selected={controller.isNodeSelected(node)}
        contextSelected={contextSelected}
        onOpen={() => dispatchOpenNodePage({ workspaceId, nodeId: node.id })}
        onToggleContextSelection={isKnowledgeNodeType(node.type) && onAskAi
          ? () => controller.toggleAiSelection(node)
          : undefined}
        onAskAi={nodeContext && onAskAi
          ? () => onAskAi({ nodes: [nodeContext] }, 'chat')
          : undefined}
        onSummarize={nodeContext && onAskAi
          ? () => onAskAi({ nodes: [nodeContext] }, 'summarize')
          : undefined}
      />
    );
  };

  return (
    <main className="workspace-nodes-page">
      <section className="workspace-nodes-page__main">
        <div className="workspace-nodes-page__top">
          <header className="workspace-nodes-page__header">
            <div>
              <div className="workspace-nodes-page__title-row">
                <h1>{t('workspaceNodes.nodes.title')}</h1>
                {onOpenGraph && (
                  <KnowledgeViewTabs value="list" onChange={(view) => view === 'graph' && onOpenGraph()} />
                )}
              </div>
              <p>
                {isFiltering && `${controller.filteredCount} / `}
                {controller.nodesCount === 1
                  ? t('workspaceNodes.nodes.subtitleOne')
                  : t('workspaceNodes.nodes.subtitle', { count: controller.nodesCount })}
              </p>
            </div>
            <div className="workspace-nodes-page__header-actions">
              <Button size="sm" onClick={() => void controller.reload()}>
                <RefreshIcon size={14} />
                {t('workspaceNodes.refresh')}
              </Button>
            </div>
          </header>

          <NodeFilters
            query={controller.query}
            onQueryChange={controller.setQuery}
            workspaces={controller.workspaceOptions}
            selectedWorkspaceIds={controller.selectedWorkspaceIds}
            onToggleWorkspace={controller.toggleWorkspace}
            workspacesAllCount={controller.workspacesAllCount}
            onResetWorkspaces={controller.resetWorkspaces}
            types={controller.typeOptions}
            typesAllCount={controller.typesAllCount}
            typeFilter={controller.typeFilter}
            onTypeFilterChange={controller.setTypeFilter}
            tags={controller.tags}
            tagsAllCount={controller.tagsAllCount}
            tagFilter={controller.tagFilter}
            onTagFilterChange={controller.setTagFilter}
            onClearFilters={controller.clearFilters}
            aiScopeLabel={controller.aiScope
              ? controller.aiScope.nodes.length > 1
                ? t('workspaceNodes.scope.askAi', { count: controller.aiScope.nodes.length })
                : controller.aiScope.nodes.length === 1
                  ? t('workspaceNodes.scope.askAiOne')
                  : t('workspaceNodes.scope.askAiScope')
              : undefined}
            onAskAiAboutScope={controller.aiScope
              ? () => onAskAi?.(controller.aiScope!, 'chat')
              : undefined}
          />
        </div>

        <div className="workspace-nodes-page__scroll" ref={controller.scrollRef}>
          {controller.error && (
            <div className="workspace-nodes-state workspace-nodes-state--error">
              {controller.error}
            </div>
          )}
          {controller.loading && (
            <div className="workspace-nodes-state">{t('workspaceNodes.loadingNodes')}</div>
          )}
          {!controller.loading && controller.filteredCount === 0 && (
            <div className="workspace-nodes-empty">
              <h2>{t('workspaceNodes.emptyTitle')}</h2>
              {noMatches ? (
                <Button size="sm" onClick={controller.clearFiltersAndQuery}>
                  {t('workspaceNodes.filter.clearAll')}
                </Button>
              ) : (
                <p>{t('workspaceNodes.emptyDescription')}</p>
              )}
            </div>
          )}
          <div className="workspace-node-grid" ref={gridRef}>
            {distributeIntoColumns(controller.visibleNodes, columns).map((column, index) => (
              <div key={index} className="workspace-node-grid__column">
                {column.map(renderCard)}
              </div>
            ))}
          </div>
          {controller.hasMore && (
            <div
              ref={controller.sentinelRef}
              className="workspace-nodes-sentinel"
              aria-hidden="true"
            />
          )}
        </div>

        {onAskAi && controller.selectedAiNodes.length > 0 && (
          <div
            className="workspace-nodes-selection-bar"
            role="toolbar"
            aria-label={t('workspaceNodes.selection.count', {
              count: controller.selectedAiNodes.length,
            })}
          >
            <span className="workspace-nodes-selection-bar__count">
              {t('workspaceNodes.selection.count', {
                count: controller.selectedAiNodes.length,
              })}
            </span>
            <Button
              size="sm"
              variant="primary"
              onClick={() => onAskAi({ nodes: controller.selectedAiNodes }, 'chat')}
            >
              <SparklesIcon size={13} />
              {t('workspaceNodes.selection.askAi')}
            </Button>
            <Button size="sm" onClick={controller.clearAiSelection}>
              {t('workspaceNodes.selection.clear')}
            </Button>
          </div>
        )}
      </section>
    </main>
  );
};
