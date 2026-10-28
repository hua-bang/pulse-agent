import { useCallback, useMemo } from 'react';
import type { AgentContextTabRef, CanvasNode } from '../../../../types';
import { buildNodeMentionInsertion, buildTabMentionInsertion } from '../../../../utils/nodeMention';
import { NodeMentionPicker } from '../../../node-mentions';

interface TerminalMentionPickerProps {
  sessionId: string;
  terminalId: string;
  nodes: CanvasNode[];
  dockTabs?: AgentContextTabRef[];
  /** Closes the picker and returns focus to the terminal. */
  onClose: () => void;
}

/** The ⌘2 picker for a dock terminal: writes a node or dock-tab mention into its PTY. */
export const TerminalMentionPicker = ({
  sessionId,
  terminalId,
  nodes,
  dockTabs,
  onClose,
}: TerminalMentionPickerProps) => {
  const write = useCallback((text: string) => {
    window.canvasWorkspace?.pty?.write(sessionId, text);
    onClose();
  }, [onClose, sessionId]);

  // A terminal does not reference itself.
  const tabs = useMemo(
    () => (dockTabs ?? []).filter((tab) => tab.id !== terminalId),
    [dockTabs, terminalId],
  );

  return (
    <NodeMentionPicker
      nodes={nodes}
      tabs={tabs}
      onSelect={(node) => write(buildNodeMentionInsertion(node))}
      onSelectTab={(tab) => write(buildTabMentionInsertion(tab))}
      onClose={onClose}
    />
  );
};
