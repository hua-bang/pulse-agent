import { useState } from 'react';
import type { WorkspaceEntry } from '../../hooks/useWorkspaces';
import type { DockStore } from './dock-store';
import { NewDockTabMenu } from './NewDockTabMenu';
import { NodeDockPicker } from './NodeDockPicker';

interface Props {
  store: DockStore;
  workspaces: WorkspaceEntry[];
  activeWorkspaceId: string;
  showTerminal: boolean;
  newTabTitle: string;
}

export const DockCreationControls = ({ store, workspaces, activeWorkspaceId, showTerminal, newTabTitle }: Props) => {
  const [nodePickerOpen, setNodePickerOpen] = useState(false);
  return (
    <>
      <NewDockTabMenu
        showTerminal={showTerminal}
        onOpenNode={() => setNodePickerOpen(true)}
        onNewWebTab={() => store.newLink(newTabTitle)}
        onNewTerminalTab={() => store.newTerminal()}
      />
      {nodePickerOpen && (
        <NodeDockPicker
          workspaces={workspaces}
          onClose={() => setNodePickerOpen(false)}
          onSelect={(node) => store.openNodeDetail(
            node.workspaceId ?? activeWorkspaceId,
            node.id,
            node.displayTitle ?? node.title ?? node.id,
          )}
        />
      )}
    </>
  );
};
