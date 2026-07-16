import { lazy, Suspense, useId, useRef, useState } from 'react';
import type { WorkspaceEntry } from '../../hooks/useWorkspaces';
import { useI18n } from '../../i18n';
import { PlusIcon } from '../icons';
import { Button } from '../ui';
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
  onSelectWorkspace: (workspaceId: string) => void;
}

export const DockCreationControls = ({ store, workspaces, activeWorkspaceId, showTerminal, newTabTitle, onSelectWorkspace }: Props) => {
  const { t } = useI18n();
  const [menuOpen, setMenuOpen] = useState(false);
  const [nodePickerOpen, setNodePickerOpen] = useState(false);
  const [workspacePickerOpen, setWorkspacePickerOpen] = useState(false);
  const anchorRef = useRef<HTMLSpanElement>(null);
  const panelId = useId();
  return (
    <>
      <span ref={anchorRef} className="right-dock__new-tab-menu">
        <Button
          variant="icon"
          size="sm"
          className="right-dock__new-link"
          aria-label={t('rightDock.newTab')}
          title={t('rightDock.newTab')}
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          aria-controls={menuOpen ? panelId : undefined}
          onClick={() => setMenuOpen((value) => !value)}
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
            onClose={() => setWorkspacePickerOpen(false)}
            onSelect={onSelectWorkspace}
          />
        </Suspense>
      )}
    </>
  );
};
