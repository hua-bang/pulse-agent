import { lazy, Suspense, useCallback, useEffect, useId, useRef, useState } from 'react';
import type { WorkspaceEntry } from '../../hooks/useWorkspaces';
import { useI18n } from '../../i18n';
import { PlusIcon } from '../icons';
import { Button } from '../ui';
import { requestPreviewEvictOpen } from '../../utils/openNodeBridge';
import type { DockStore } from './dock-store';

const NewDockTabMenu = lazy(() => (
  import('./NewDockTabMenu').then((module) => ({ default: module.NewDockTabMenu }))
));
const NodeDockPicker = lazy(() => (
  import('./NodeDockPicker').then((module) => ({ default: module.NodeDockPicker }))
));
const WorkspaceDockPicker = lazy(() => (
  import('./WorkspaceDockPicker').then((module) => ({ default: module.WorkspaceDockPicker }))
));

interface Props {
  store: DockStore;
  workspaces: WorkspaceEntry[];
  activeWorkspaceId: string;
  showTerminal: boolean;
  newTabTitle: string;
  mountedWorkspaceIds: ReadonlySet<string>;
  terminalWorkspaceIds: ReadonlySet<string>;
}

/** Grace period for the pointer to cross the gap between the + trigger and
 *  the portaled menu panel (or briefly leave and come back) before the
 *  hover-opened menu closes. */
const HOVER_CLOSE_DELAY_MS = 240;

export const DockCreationControls = ({ store, workspaces, activeWorkspaceId, showTerminal, newTabTitle, mountedWorkspaceIds, terminalWorkspaceIds }: Props) => {
  const { t } = useI18n();
  const [menuOpen, setMenuOpen] = useState(false);
  const [nodePickerOpen, setNodePickerOpen] = useState(false);
  const [workspacePickerOpen, setWorkspacePickerOpen] = useState(false);
  const anchorRef = useRef<HTMLSpanElement>(null);
  const panelId = useId();

  // Hover-triggered menu: entering the trigger (or the panel) opens/keeps it,
  // leaving either schedules a delayed close so the pointer can travel
  // between them. Click still opens for keyboard/tap users; dismissal is
  // Escape, an outside press, or moving the pointer away.
  const closeTimerRef = useRef<number | null>(null);
  const cancelScheduledClose = useCallback(() => {
    if (closeTimerRef.current !== null) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  }, []);
  const openMenu = useCallback(() => {
    cancelScheduledClose();
    setMenuOpen(true);
  }, [cancelScheduledClose]);
  const scheduleClose = useCallback(() => {
    cancelScheduledClose();
    closeTimerRef.current = window.setTimeout(() => {
      closeTimerRef.current = null;
      setMenuOpen(false);
    }, HOVER_CLOSE_DELAY_MS);
  }, [cancelScheduledClose]);
  useEffect(() => cancelScheduledClose, [cancelScheduledClose]);

  return (
    <>
      <span
        ref={anchorRef}
        className="right-dock__new-tab-menu"
        onMouseEnter={() => {
          if (!nodePickerOpen && !workspacePickerOpen) openMenu();
        }}
        onMouseLeave={scheduleClose}
      >
        <Button
          variant="icon"
          size="sm"
          className="right-dock__new-link"
          aria-label={t('rightDock.newTab')}
          title={t('rightDock.newTab')}
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          aria-controls={menuOpen ? panelId : undefined}
          onClick={openMenu}
        >
          <PlusIcon size={16} />
        </Button>
        {menuOpen && (
          <Suspense fallback={null}>
            <NewDockTabMenu
              anchorRef={anchorRef}
              panelId={panelId}
              showTerminal={showTerminal}
              onClose={() => setMenuOpen(false)}
              onOpenNode={() => setNodePickerOpen(true)}
              onOpenCanvas={() => setWorkspacePickerOpen(true)}
              onNewWebTab={() => store.newLink(newTabTitle)}
              onNewTerminalTab={() => store.newTerminal()}
              onHoverEnter={cancelScheduledClose}
              onHoverLeave={scheduleClose}
            />
          </Suspense>
        )}
      </span>
      {nodePickerOpen && (
        <Suspense fallback={null}>
          <NodeDockPicker
            workspaces={workspaces}
            onClose={() => setNodePickerOpen(false)}
            onSelect={(node) => store.openNodeDetail(
              node.workspaceId ?? activeWorkspaceId,
              node.id,
              node.displayTitle ?? node.title ?? node.id,
            )}
          />
        </Suspense>
      )}
      {workspacePickerOpen && (
        <Suspense fallback={null}>
          <WorkspaceDockPicker
            workspaces={workspaces}
            activeWorkspaceId={activeWorkspaceId}
            mountedWorkspaceIds={mountedWorkspaceIds}
            terminalWorkspaceIds={terminalWorkspaceIds}
            onClose={() => setWorkspacePickerOpen(false)}
            onSelect={(workspace) => {
              // Refused = background-mounted: ask the Workbench to tear the
              // live instance down and open the preview in its place.
              if (!store.openCanvasPreview(workspace.id, workspace.name)) {
                requestPreviewEvictOpen({ workspaceId: workspace.id, title: workspace.name });
              }
            }}
          />
        </Suspense>
      )}
    </>
  );
};
