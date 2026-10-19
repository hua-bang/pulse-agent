import { useEffect, useState, type RefObject } from 'react';
import type { FolderEntry, WorkspaceEntry } from '../../../shared/workspaces';
import { WorkspaceIcon } from '../../../components/icons';
import { Button, Popover } from '../../../components/ui';
import { useI18n } from '../../../i18n';

/** Short pause before opening, so the pointer can cross the rail without a flash. */
const HOVER_OPEN_DELAY_MS = 120;
/** Grace period for the pointer to cross the gap into the portaled panel. */
const HOVER_CLOSE_DELAY_MS = 240;

interface WorkspaceFlyoutProps {
  anchorRef: RefObject<HTMLElement>;
  /** The pointer is over the rail's Workspaces icon. */
  triggerHovered: boolean;
  workspaces: WorkspaceEntry[];
  folders: FolderEntry[];
  activeId: string;
  onSelect: (id: string) => void;
}

/**
 * The workspace list beside the narrow rail's Workspaces icon, so switching
 * canvases does not need the wide rail. Folders keep the tree's order. The
 * rail only reports hover; this lazy module owns the open/close timing so it
 * stays out of the startup bundle.
 */
const WorkspaceFlyout = ({
  anchorRef,
  triggerHovered,
  workspaces,
  folders,
  activeId,
  onSelect,
}: WorkspaceFlyoutProps) => {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [panelHovered, setPanelHovered] = useState(false);
  const hovered = triggerHovered || panelHovered;

  useEffect(() => {
    const timer = window.setTimeout(() => setOpen(hovered), hovered ? HOVER_OPEN_DELAY_MS : HOVER_CLOSE_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [hovered]);

  if (!open) return null;

  const close = () => {
    setOpen(false);
    setPanelHovered(false);
  };
  const rect = anchorRef.current?.getBoundingClientRect();

  const groups = [
    ...folders.map((folder) => ({
      id: folder.id,
      name: folder.name,
      items: workspaces.filter((ws) => ws.folderId === folder.id),
    })),
    { id: '__root__', name: '', items: workspaces.filter((ws) => !ws.folderId) },
  ].filter((group) => group.items.length > 0);

  const renderItem = (ws: WorkspaceEntry) => (
    <Button
      key={ws.id}
      size="sm"
      role="menuitem"
      className={`sidebar-item-menu-item sidebar-flyout-item${ws.id === activeId ? ' sidebar-flyout-item--active' : ''}`}
      aria-current={ws.id === activeId ? 'true' : undefined}
      onClick={() => {
        onSelect(ws.id);
        close();
      }}
    >
      <WorkspaceIcon size={13} />
      <span className="sidebar-flyout-name">{ws.name}</span>
    </Button>
  );

  return (
    <Popover
      x={(rect?.right ?? 0) + 8}
      y={(rect?.top ?? 0) - 4}
      autoFocus={false}
      ariaLabel={t('sidebar.workspaces')}
      className="sidebar-item-menu sidebar-flyout"
      onClose={close}
      onMouseEnter={() => setPanelHovered(true)}
      onMouseLeave={() => setPanelHovered(false)}
    >
      <div className="sidebar-flyout-title">{t('sidebar.workspaces')}</div>
      {groups.map((group) => (
        <div key={group.id} className="sidebar-flyout-group" role="group" aria-label={group.name || undefined}>
          {group.name && <div className="sidebar-flyout-folder">{group.name}</div>}
          {group.items.map(renderItem)}
        </div>
      ))}
    </Popover>
  );
};

// Default export keeps the rail's lazy() import free of a re-wrap.
export default WorkspaceFlyout;
