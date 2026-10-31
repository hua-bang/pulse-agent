import { lazy, Suspense, useEffect, useRef, useState, type CSSProperties, type MouseEvent } from 'react';
import { SidebarSimple } from '@phosphor-icons/react';
import type { WorkspaceEntry } from '../../../shared/workspaces';
import { CloseIcon, PlusIcon, WorkspaceIcon } from '../../../components/icons';
import { Button, TextField } from '../../../components/ui';
import { useI18n } from '../../../i18n';
import { CLOSE_ACTIVE_TAB_EVENT, REOPEN_CLOSED_TAB_EVENT } from '../../shortcuts/useAppShortcuts';
import { isImeComposing } from '../../../utils/ime';
import { useOpenWorkspaceTabs } from './useOpenWorkspaceTabs';
import { WorkspacePicker } from './WorkspacePicker';
import './index.css';

// Loads on the first right-click, outside the startup bundle.
const WorkspaceTabMenu = lazy(() => import('./WorkspaceTabMenu').then((m) => ({ default: m.WorkspaceTabMenu })));

interface Props {
  workspaces: WorkspaceEntry[];
  activeId: string;
  onSelect: (id: string) => void;
  onCreate: () => void;
  onRename: (id: string, name: string) => void;
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
  onRename,
  onOpenLauncher,
  panelCollapsed,
  onTogglePanel,
}: Props) => {
  const { t } = useI18n();
  const newButtonRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLElement>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const menuAnchorRef = useRef<HTMLButtonElement | null>(null);
  const [menuTabId, setMenuTabId] = useState<string | null>(null);
  // Like Chrome: closing a tab keeps the others at their width until the
  // pointer leaves the bar, so the next close button stays under it.
  const [frozenWidth, setFrozenWidth] = useState<number | null>(null);
  // Double-clicking a tab name edits it in place.
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const { openIds, close, closeOthers, takeClosed } = useOpenWorkspaceTabs(workspaces, activeId);
  const byId = new Map(workspaces.map((ws) => [ws.id, ws]));
  const tabs = openIds.flatMap((id) => {
    const workspace = byId.get(id);
    return workspace ? [workspace] : [];
  });

  // Tabs keep their width when the dock opens, so the active one can sit past
  // the visible edge of the list. Keep it in view on switch and on resize.
  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const reveal = () => list
      .querySelector('.workspace-tabs__tab--active')
      ?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
    reveal();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(reveal);
    observer.observe(list);
    return () => observer.disconnect();
  }, [activeId, tabs.length]);

  const onClose = (id: string) => {
    const next = close(id);
    if (id !== activeId) return;
    if (next) onSelect(next);
    else onOpenLauncher();
  };

  // Mod+W from the app shortcut layer. The ref keeps one listener while
  // onClose changes every render.
  const closeActiveRef = useRef(() => {});
  closeActiveRef.current = () => {
    if (activeId) onClose(activeId);
  };
  // Mod+Shift+T: selecting the workspace opens its tab again.
  const reopenRef = useRef(() => {});
  reopenRef.current = () => {
    const id = takeClosed();
    if (id) onSelect(id);
  };
  useEffect(() => {
    const close = () => closeActiveRef.current();
    const reopen = () => reopenRef.current();
    window.addEventListener(CLOSE_ACTIVE_TAB_EVENT, close);
    window.addEventListener(REOPEN_CLOSED_TAB_EVENT, reopen);
    return () => {
      window.removeEventListener(CLOSE_ACTIVE_TAB_EVENT, close);
      window.removeEventListener(REOPEN_CLOSED_TAB_EVENT, reopen);
    };
  }, []);

  const closeFromPointer = (event: MouseEvent<HTMLElement>, id: string) => {
    const tab = event.currentTarget.closest('.workspace-tabs__tab');
    if (tab) setFrozenWidth(tab.getBoundingClientRect().width);
    onClose(id);
  };

  const openTabMenu = (event: MouseEvent<HTMLElement>, id: string) => {
    event.preventDefault();
    menuAnchorRef.current = event.currentTarget.querySelector('.workspace-tabs__select');
    setMenuTabId(id);
  };

  const keepOnlyTab = (id: string) => {
    closeOthers(id);
    if (id !== activeId) onSelect(id);
  };

  const startRename = (workspace: WorkspaceEntry) => {
    setRenamingId(workspace.id);
    setRenameValue(workspace.name);
  };

  const commitRename = () => {
    // onRename ignores a blank or unchanged name.
    if (renamingId) onRename(renamingId, renameValue);
    setRenamingId(null);
  };

  const menuTab = menuTabId ? byId.get(menuTabId) : undefined;

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
        ref={listRef}
        className="workspace-tabs__list"
        aria-label={t('workspaceTabs.label')}
        data-frozen={frozenWidth !== null || undefined}
        style={{
          '--tab-count': tabs.length,
          ...(frozenWidth !== null ? { '--tab-frozen-width': `${frozenWidth}px` } : {}),
        } as CSSProperties}
      >
        {tabs.map((workspace) => {
          const active = workspace.id === activeId;
          return (
            <div
              key={workspace.id}
              className={`workspace-tabs__tab${active ? ' workspace-tabs__tab--active' : ''}`}
              onAuxClick={(event) => handleAuxClick(event, workspace.id)}
              onContextMenu={(event) => openTabMenu(event, workspace.id)}
            >
              {renamingId === workspace.id ? (
                <div className="workspace-tabs__select workspace-tabs__select--renaming">
                  <WorkspaceIcon size={13} />
                  <TextField
                    className="workspace-tabs__rename"
                    value={renameValue}
                    aria-label={t('workspaceTabs.rename')}
                    autoFocus
                    onFocus={(event) => event.currentTarget.select()}
                    onChange={(event) => setRenameValue(event.target.value)}
                    onBlur={commitRename}
                    onKeyDown={(event) => {
                      if (isImeComposing(event)) return;
                      if (event.key === 'Enter') commitRename();
                      if (event.key === 'Escape') setRenamingId(null);
                    }}
                  />
                </div>
              ) : (
                <Button
                  variant="secondary"
                  size="sm"
                  aria-current={active ? 'page' : undefined}
                  className="workspace-tabs__select"
                  onClick={() => onSelect(workspace.id)}
                  onDoubleClick={() => startRename(workspace)}
                  title={workspace.name}
                >
                  <WorkspaceIcon size={13} />
                  <span className="workspace-tabs__name">{workspace.name}</span>
                </Button>
              )}
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
      {menuTab && (
        <Suspense fallback={null}>
          <WorkspaceTabMenu
            anchorRef={menuAnchorRef}
            name={menuTab.name}
            canCloseOthers={tabs.length > 1}
            onClose={() => setMenuTabId(null)}
            onCloseTab={() => {
              setMenuTabId(null);
              onClose(menuTab.id);
            }}
            onCloseOthers={() => {
              setMenuTabId(null);
              keepOnlyTab(menuTab.id);
            }}
          />
        </Suspense>
      )}
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
