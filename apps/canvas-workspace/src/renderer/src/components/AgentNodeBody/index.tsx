import { useState, useCallback } from 'react';
import type { CanvasNode, AgentNodeData, AgentRuntime } from '../../types';
import { AgentHeader } from './AgentHeader';
import { AgentTaskPanel } from './AgentTaskPanel';
import { AgentTerminal } from './AgentTerminal';
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

  const handleStart = useCallback(async () => {
    const api = window.canvasWorkspace?.agentTeam;
    if (!api || !data.name) return;

    const teammateId = data.teammateId || data.name || node.id;
    updateData({ teammateId, status: 'running' });

    try {
      const result = await api.spawn({
        teammateId,
        runtime: data.runtime,
        cwd: undefined, // will use homedir
        model: data.model,
        spawnPrompt: data.spawnPrompt,
      });

      if (!result.ok) {
        updateData({ status: 'failed' });
      }
    } catch {
      updateData({ status: 'failed' });
    }
  }, [data, node.id, updateData]);

  const handleStop = useCallback(async () => {
    const api = window.canvasWorkspace?.agentTeam;
    const teammateId = data.teammateId || data.name;
    if (!api || !teammateId) return;

    await api.stop(teammateId);
    updateData({ status: 'stopped' });
  }, [data, updateData]);

  const isRunning = data.status === 'running' || data.status === 'waiting';
  const canStart = data.status === 'idle' || data.status === 'stopped' || data.status === 'failed' || data.status === 'completed';

  return (
    <div className="agent-node-body">
      <AgentHeader
        data={data}
        onRuntimeChange={handleRuntimeChange}
        onConfigToggle={() => setConfigOpen((v) => !v)}
        onStart={canStart ? handleStart : undefined}
        onStop={isRunning ? handleStop : undefined}
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

      <AgentTerminal
        teammateId={data.teammateId || data.name || ''}
        status={data.status}
      />
    </div>
  );
};
