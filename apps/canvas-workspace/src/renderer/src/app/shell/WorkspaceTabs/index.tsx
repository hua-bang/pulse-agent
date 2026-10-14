import { useRef, useState, type CSSProperties, type MouseEvent } from 'react';
import { SidebarSimple } from '@phosphor-icons/react';
import type { WorkspaceEntry } from '../../../shared/workspaces';
import { CloseIcon, PlusIcon, WorkspaceIcon } from '../../../components/icons';
import { Button } from '../../../components/ui';
import { useI18n } from '../../../i18n';
import { useOpenWorkspaceTabs } from './useOpenWorkspaceTabs';
import { WorkspacePicker } from './WorkspacePicker';
import './index.css';

interface Props {
  workspaces: WorkspaceEntry[];
  activeId: string;
  onSelect: (id: string) => void;
  onCreate: () => void;
  /** Opens the launcher; also used when the last tab closes. */
  onOpenLauncher: () => void;
  /** Whether the workspace panel beside the rail is closed. */
  panelCollapsed: boolean;
  onTogglePanel: () => void;
}

/** Open workspaces as tabs above the canvas, like browser tabs. */
export const WorkspaceTabs = ({
  workspaces,
  activeId,
  onSelect,
  onCreate,
  onOpenLauncher,
  panelCollapsed,
  onTogglePanel,
}: Props) => {
  const { t } = useI18n();
  const newButtonRef = useRef<HTMLButtonElement>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  // Like Chrome: closing a tab keeps the others at their width until the
  // pointer leaves the bar, so the next close button stays under it.
  const [frozenWidth, setFrozenWidth] = useState<number | null>(null);
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

  const closeFromPointer = (event: MouseEvent<HTMLElement>, id: string) => {
    const tab = event.currentTarget.closest('.workspace-tabs__tab');
    if (tab) setFrozenWidth(tab.getBoundingClientRect().width);
    onClose(id);
  };

  const handleAuxClick = (event: MouseEvent<HTMLElement>, id: string) => {
    if (event.button !== 1) return;
    event.preventDefault();
    closeFromPointer(event, id);
  };

  return (
    <div className="workspace-tabs" onMouseLeave={() => setFrozenWidth(null)}>
      {/* With the panel closed, the rail icon is the only other way back, and
          it does not read as a toggle. */}
      {panelCollapsed && (
        <Button
          variant="icon"
          size="sm"
          className="workspace-tabs__panel"
          onClick={onTogglePanel}
          title={t('sidebar.expand')}
          aria-label={t('sidebar.expand')}
        >
          <SidebarSimple size={14} />
        </Button>
      )}
      <nav
        className="workspace-tabs__list"
        aria-label={t('workspaceTabs.label')}
        data-frozen={frozenWidth !== null || undefined}
        style={frozenWidth !== null ? { '--tab-frozen-width': `${frozenWidth}px` } as CSSProperties : undefined}
      >
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
                onClick={(event) => closeFromPointer(event, workspace.id)}
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
        ref={newButtonRef}
        variant="icon"
        size="sm"
        className="workspace-tabs__new"
        onClick={() => setPickerOpen((open) => !open)}
        title={t('workspaceTabs.open')}
        aria-label={t('workspaceTabs.open')}
        aria-haspopup="menu"
        aria-expanded={pickerOpen}
      >
        <PlusIcon size={13} />
      </Button>
      {pickerOpen && (
        <WorkspacePicker
          anchorRef={newButtonRef}
          workspaces={workspaces}
          activeId={activeId}
          onSelect={onSelect}
          onCreate={onCreate}
          onOpenLauncher={onOpenLauncher}
          onClose={() => setPickerOpen(false)}
        />
      )}
    </div>
  );
};
