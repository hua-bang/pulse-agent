import type { WorkspaceEntry } from '../../../shared/workspaces';
import { PlusIcon } from '../../../components/icons';
import { Button } from '../../../components/ui';
import { useI18n } from '../../../i18n';
import type { WorkspaceSummary } from './useLauncherData';

interface Props {
  /** Already in recency order. */
  workspaces: WorkspaceEntry[];
  summaries: Record<string, WorkspaceSummary>;
  onOpenWorkspace: (id: string) => void;
  onCreateWorkspace: () => void;
}

/**
 * Recently opened workspaces as cards, each with a peek at its first cards
 * (real titles, colored by card type) and its card count.
 */
export const RecentWorkspaces = ({ workspaces, summaries, onOpenWorkspace, onCreateWorkspace }: Props) => {
  const { t } = useI18n();
  const describe = (summary: WorkspaceSummary | undefined) => {
    if (!summary) return '';
    if (summary.nodeCount === 0) return t('launcher.workspaceEmpty');
    return t('launcher.workspaceMeta', { count: summary.nodeCount });
  };

  return (
    <section className="launcher__section" aria-labelledby="launcher-workspaces">
      <h2 id="launcher-workspaces" className="launcher__section-title">
        {t('launcher.recentWorkspaces')}
      </h2>
      <div className="launcher__grid">
        {workspaces.map((workspace) => {
          const summary = summaries[workspace.id];
          return (
            <Button
              key={workspace.id}
              variant="secondary"
              className="launcher__card"
              onClick={() => onOpenWorkspace(workspace.id)}
              title={workspace.name}
            >
              <span className="launcher__thumb" aria-hidden="true">
                {summary?.cards.map((card, index) => (
                  <span
                    key={index}
                    className="launcher__thumb-card"
                    data-type={card.type}
                    style={{ height: card.height }}
                  >
                    <span className="launcher__thumb-title">
                      {card.title || <span className="launcher__thumb-line" />}
                    </span>
                    <span className="launcher__thumb-line" />
                    <span className="launcher__thumb-line launcher__thumb-line--short" />
                  </span>
                ))}
              </span>
              <span className="launcher__card-info">
                <span className="launcher__card-name">{workspace.name}</span>
                <span className="launcher__card-meta">{describe(summary)}</span>
              </span>
            </Button>
          );
        })}
        <Button variant="secondary" className="launcher__card launcher__card--new" onClick={onCreateWorkspace}>
          <PlusIcon size={16} />
          <span className="launcher__card-name">{t('launcher.newWorkspace')}</span>
        </Button>
      </div>
    </section>
  );
};
