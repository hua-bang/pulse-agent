import { useState, useCallback } from 'react';
import type { CanvasNode, AgentNodeData, AgentRuntime } from '../../types';
import { AgentHeader } from './AgentHeader';
import { AgentTaskPanel } from './AgentTaskPanel';
import { AgentTerminalPlaceholder } from './AgentTerminalPlaceholder';
import { AgentPlanReview } from './AgentPlanReview';
import { AgentConfig } from './AgentConfig';

interface Props {
  node: CanvasNode;
  onUpdate: (id: string, patch: Partial<CanvasNode>) => void;
}

export const AgentNodeBody = ({ node, onUpdate }: Props) => {
  const data = node.data as AgentNodeData;
  const [taskPanelOpen, setTaskPanelOpen] = useState(true);
  const [configOpen, setConfigOpen] = useState(!data.name);

  const updateData = useCallback(
    (patch: Partial<AgentNodeData>) => {
      onUpdate(node.id, { data: { ...data, ...patch } });
    },
    [node.id, data, onUpdate]
  );

  const handleRuntimeChange = useCallback(
    (runtime: AgentRuntime) => {
      updateData({ runtime });
    },
    [updateData]
  );

  return (
    <div className="agent-node-body">
      <AgentHeader
        data={data}
        onRuntimeChange={handleRuntimeChange}
        onConfigToggle={() => setConfigOpen((v) => !v)}
      />

      {configOpen && (
        <AgentConfig
          data={data}
          onUpdate={updateData}
        />
      )}

      {data.tasks && data.tasks.length > 0 && (
        <AgentTaskPanel
          tasks={data.tasks}
          currentTaskId={data.currentTask?.id}
          open={taskPanelOpen}
          onToggle={() => setTaskPanelOpen((v) => !v)}
        />
      )}

      <AgentTerminalPlaceholder status={data.status} />

      {data.isLead && data.status === 'idle' && (
        <div className="agent-lead-actions">
          <button className="agent-btn agent-btn--primary" disabled>
            Run Team
          </button>
        </div>
      )}
    </div>
  );
};
