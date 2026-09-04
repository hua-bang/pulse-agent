import { useRightDock, useRightDockState } from '../../../../../shared/dockPort';
import { AgentTeamCreationButton } from './AgentTeamCreationButton';
import { NodeCreationGroup } from './NodeCreationGroup';
import { PanelToggles } from './PanelToggles';
import { PluginNodeMenu } from './PluginNodeMenu';
import { ToolModeGroup } from './ToolModeGroup';
import type { AddCanvasNode } from './types';
import './index.css';

interface Props {
  activeTool: string;
  onToolChange: (tool: string) => void;
  onAddNode: AddCanvasNode;
  onCreateAgentTeam?: () => void;
  chatPanelOpen?: boolean;
  onChatToggle?: () => void;
  referenceDrawerOpen?: boolean;
  onReferenceToggle?: () => void;
}

// Lower-priority controls remain implemented for a future More menu while the
// primary canvas toolbar stays focused.
const SECONDARY_VISIBLE = {
  shapes: false,
  pluginNodes: false,
  agentTeams: false,
} as const;

export const FloatingToolbar = ({
  activeTool,
  onToolChange,
  onAddNode,
  onCreateAgentTeam,
  chatPanelOpen,
  onChatToggle,
  referenceDrawerOpen,
  onReferenceToggle,
}: Props) => {
  const dock = useRightDock();
  const dockState = useRightDockState();
  const terminalDockOpen = dockState.expanded
    && dockState.terminalTabs.some((tab) => tab.id === dockState.activeTabId);

  return (
    <div className="floating-toolbar">
      <PanelToggles
        chatPanelOpen={chatPanelOpen}
        onChatToggle={onChatToggle}
        referenceDrawerOpen={referenceDrawerOpen}
        onReferenceToggle={onReferenceToggle}
      />
      <ToolModeGroup
        activeTool={activeTool}
        onToolChange={onToolChange}
        showShapes={SECONDARY_VISIBLE.shapes}
      />
      <div className="toolbar-divider" />
      <NodeCreationGroup
        terminalDockOpen={terminalDockOpen}
        showTerminalAdd={dockState.terminalTabs.length > 0}
        onAddNode={onAddNode}
        onTerminalToggle={dock.toggleTerminal}
        onNewTerminal={dock.newTerminal}
      />
      {SECONDARY_VISIBLE.agentTeams && onCreateAgentTeam && (
        <AgentTeamCreationButton onCreate={onCreateAgentTeam} />
      )}
      {SECONDARY_VISIBLE.pluginNodes && <PluginNodeMenu onAddNode={onAddNode} />}
    </div>
  );
};
