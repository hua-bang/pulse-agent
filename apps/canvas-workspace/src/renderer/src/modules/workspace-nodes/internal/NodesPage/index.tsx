import type { WorkspaceEntry } from '../../../../shared/workspaces';
import { RefreshIcon, SparklesIcon } from '../../../../components/icons';
import { Button } from '../../../../components/ui/Button';
import { useI18n } from '../../../../i18n';
import { useRightDock } from '../../../../shared/dockPort';
import { dispatchOpenNodePage } from '../../../../utils/openNodeBridge';
import { KnowledgeNodeCard } from '../KnowledgeNodeCard';
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
import { useNodesPageController } from './useNodesPageController';
import './index.css';

interface NodesPageProps {
  workspaces: WorkspaceEntry[];
  onAskAi?: (context: NodesAiContext, action: 'chat' | 'summarize') => void;
}

export const NodesPage = ({ workspaces, onAskAi }: NodesPageProps) => {
  const { t } = useI18n();
  const dock = useRightDock();
  const controller = useNodesPageController({
    workspaces,
    aiEnabled: Boolean(onAskAi),
  });

  return (
    <main className="workspace-nodes-page">
      <section className="workspace-nodes-page__main">
        <div className="workspace-nodes-page__top">
          <header className="workspace-nodes-page__header">
            <div>
              <h1>{t('workspaceNodes.nodes.title')}</h1>
              <p>{t('workspaceNodes.nodes.subtitle', { count: controller.nodesCount })}</p>
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
            activeWorkspaceIds={controller.activeWorkspaceIds}
            selectedWorkspaceIds={controller.selectedWorkspaceIds}
            onToggleWorkspace={controller.toggleWorkspace}
            onResetWorkspaces={controller.resetWorkspaces}
            typeFilter={controller.typeFilter}
            onTypeFilterChange={controller.setTypeFilter}
            tags={controller.tags}
            tagFilter={controller.tagFilter}
            onTagFilterChange={controller.setTagFilter}
            aiScopeLabel={controller.aiScope
              ? controller.aiScope.nodes.length > 0
                ? t('workspaceNodes.scope.askAi', { count: controller.aiScope.nodes.length })
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
              <p>{t('workspaceNodes.emptyDescription')}</p>
            </div>
          )}
          <div className="workspace-node-grid">
            {controller.visibleNodes.map((node) => {
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
                  emptyPreviewLabel={t('workspaceNodes.noPreview')}
                  aiSummaryLabel={t('workspaceNodes.aiSummary')}
                  aiSummaryConfirmedLabel={t('workspaceNodes.aiSummaryConfirmed')}
                  aiSummarizeLabel={t('workspaceNodes.aiSummarize')}
                  aiChatLabel={t('workspaceNodes.aiChat')}
                  goToDetailLabel={t('workspaceNodes.goToDetail')}
                  selectForAiLabel={t('workspaceNodes.selectForAi')}
                  deselectForAiLabel={t('workspaceNodes.deselectForAi')}
                  openLabel={t('workspaceNodes.openNodeTab', { title })}
                  selected={controller.isNodeSelected(node)}
                  contextSelected={contextSelected}
                  onOpen={() => dock.openNodeDetail(workspaceId, node.id, title)}
                  onOpenDetail={() => dispatchOpenNodePage({ workspaceId, nodeId: node.id })}
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
            })}
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
