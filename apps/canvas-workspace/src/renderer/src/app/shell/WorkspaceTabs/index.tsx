import type { MouseEvent } from 'react';
import type { WorkspaceEntry } from '../../../shared/workspaces';
import { CloseIcon, PlusIcon, WorkspaceIcon } from '../../../components/icons';
import { Button } from '../../../components/ui';
import { useI18n } from '../../../i18n';
import { useOpenWorkspaceTabs } from './useOpenWorkspaceTabs';
import './index.css';

interface Props {
  workspaces: WorkspaceEntry[];
  activeId: string;
  onSelect: (id: string) => void;
  /** Opens the launcher; also used when the last tab closes. */
  onOpenLauncher: () => void;
}

/** Open workspaces as tabs above the canvas, like browser tabs. */
export const WorkspaceTabs = ({
  workspaces,
  activeId,
  onSelect,
  onOpenLauncher,
}: Props) => {
  const { t } = useI18n();
  const { openIds, close } = useOpenWorkspaceTabs(workspaces, activeId);
  const byId = new Map(workspaces.map((ws) => [ws.id, ws]));
  const tabs = openIds.flatMap((id) => {
    const workspace = byId.get(id);
    return workspace ? [workspace] : [];
  });

  const onClose = (id: string) => {
    const next = close(id);
    if (id !== activeId) return;
    if (next) onSelect(next);
    else onOpenLauncher();
  };

  const handleAuxClick = (event: MouseEvent, id: string) => {
    if (event.button !== 1) return;
    event.preventDefault();
    onClose(id);
  };

  return (
    <div className="workspace-tabs">
      <nav className="workspace-tabs__list" aria-label={t('workspaceTabs.label')}>
        {tabs.map((workspace) => {
          const active = workspace.id === activeId;
          return (
            <div
              key={workspace.id}
              className={`workspace-tabs__tab${active ? ' workspace-tabs__tab--active' : ''}`}
              onAuxClick={(event) => handleAuxClick(event, workspace.id)}
            >
              <Button
                variant="secondary"
                size="sm"
                aria-current={active ? 'page' : undefined}
                className="workspace-tabs__select"
                onClick={() => onSelect(workspace.id)}
                title={workspace.name}
              >
                <WorkspaceIcon size={13} />
                <span className="workspace-tabs__name">{workspace.name}</span>
              </Button>
              <Button
                variant="icon"
                size="xs"
                className="workspace-tabs__close"
                onClick={() => onClose(workspace.id)}
                title={t('workspaceTabs.close', { name: workspace.name })}
                aria-label={t('workspaceTabs.close', { name: workspace.name })}
              >
                <CloseIcon size={11} />
              </Button>
            </div>
          );
        })}
      </nav>
      <Button
        variant="icon"
        size="sm"
        className="workspace-tabs__new"
        onClick={onOpenLauncher}
        title={t('workspaceTabs.open')}
        aria-label={t('workspaceTabs.open')}
      >
        <PlusIcon size={13} />
      </Button>
    </div>
  );
};
