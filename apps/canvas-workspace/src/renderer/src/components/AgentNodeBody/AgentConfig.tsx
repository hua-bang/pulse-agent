import { useCallback } from 'react';
import type { AgentNodeData } from '../../types';

interface Props {
  data: AgentNodeData;
  onUpdate: (patch: Partial<AgentNodeData>) => void;
}

export const AgentConfig = ({ data, onUpdate }: Props) => {
  const handleChange = useCallback(
    (field: keyof AgentNodeData) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      onUpdate({ [field]: e.target.value });
    },
    [onUpdate]
  );

  return (
    <div className="agent-config" onMouseDown={(e) => e.stopPropagation()}>
      <div className="agent-config-row">
        <label className="agent-config-label">Name</label>
        <input
          className="agent-config-input"
          value={data.name}
          onChange={handleChange('name')}
          placeholder="e.g. researcher"
        />
      </div>
      <div className="agent-config-row">
        <label className="agent-config-label">Role</label>
        <input
          className="agent-config-input"
          value={data.role}
          onChange={handleChange('role')}
          placeholder="e.g. Code analysis specialist"
        />
      </div>
      <div className="agent-config-row">
        <label className="agent-config-label">Model</label>
        <input
          className="agent-config-input"
          value={data.model || ''}
          onChange={handleChange('model')}
          placeholder="e.g. claude-sonnet-4-6"
        />
      </div>
      <div className="agent-config-row">
        <label className="agent-config-label">Prompt</label>
        <textarea
          className="agent-config-textarea"
          value={data.spawnPrompt || ''}
          onChange={handleChange('spawnPrompt')}
          placeholder="Instructions for this agent..."
          rows={3}
        />
      </div>
    </div>
  );
};
