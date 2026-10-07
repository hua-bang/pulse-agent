import { lazy, Suspense, useCallback, useEffect, useId, useRef, useState } from 'react';
import type { WorkspaceEntry } from '../../../../shared/workspaces';
import { useI18n } from '../../../../i18n';
import { PlusIcon } from '../../../../components/icons';
import { Button } from '../../../../components/ui';
import { requestPreviewEvictOpen } from '../../../../utils/openNodeBridge';
import type { DockStore } from './state/dock-store';

const NewDockTabMenu = lazy(() => (
  import('./tabs/NewDockTabMenu').then((module) => ({ default: module.NewDockTabMenu }))
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
  const [folderError, setFolderError] = useState('');
  const openFolder = async () => {
    setFolderError('');
    const scope = store.getSnapshot().activeTerminalWorkspaceId;
    const boundFolder = workspaces.find(workspace => workspace.id === scope)?.rootFolder;
    const existing = store.getSnapshot().tabs.find(tab => tab.kind === 'folder');
    if (boundFolder) { store.openFolder(boundFolder); return; }
    if (existing) { store.activate(existing.id); return; }
    try {
      const result = await window.canvasWorkspace?.dialog.openFolder();
      if (result?.canceled || scope !== store.getSnapshot().activeTerminalWorkspaceId) return;
      if (!result?.ok || !result.folderPath) throw new Error(result?.error || t('folder.openFailed'));
      store.openFolder(result.folderPath);
    } catch (error) {
      setFolderError(`${t('folder.openFailed')}: ${String(error)}`);
    }
  };
  const [menuOpen, setMenuOpen] = useState(false);
  const [nodePickerOpen, setNodePickerOpen] = useState(false);
  const [workspacePickerOpen, setWorkspacePickerOpen] = useState(false);
  const anchorRef = useRef<HTMLSpanElement>(null);
  const panelId = useId();

  // Every activation path means the same thing: reveal the creation menu.
  // Hover keeps the fast pointer path, while click (and therefore native
  // Enter/Space button activation) plus ArrowUp/Down serve tap and keyboard.
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
          size="md"
          className="right-dock__new-link"
          aria-label={t('rightDock.newTab')}
          title={t('rightDock.newTab')}
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          aria-controls={menuOpen ? panelId : undefined}
          onClick={openMenu}
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
              event.preventDefault();
              openMenu();
            }
          }}
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
              onOpenFolder={() => { void openFolder(); }}
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
      {folderError && <span role="alert">{folderError}</span>}
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
