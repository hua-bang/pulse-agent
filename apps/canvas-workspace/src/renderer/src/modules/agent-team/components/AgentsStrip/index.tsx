import { AgentIcon } from '../../../coding-agent/icon';
import type { AgentTeamAgentRecord } from '../../../../types';
import { AgentTypeSelect } from '../AgentTeamFrame/AgentTypeSelect';
import { agentSessionHealthSuffix, agentTeamStatusLabel } from '../visualLabels';
import type { AgentDef } from '../../../../config/agentRegistry';

export interface AgentSummaryItem {
  key: string; name: string; role: 'lead' | 'teammate'; agentType?: string; status: string;
  taskCount: number; doneCount: number; runningCount: number; blockedCount: number;
  artifactCount: number; toolCount?: number; currentTaskTitle?: string; nodeId?: string;
  sourceAgent?: AgentTeamAgentRecord; sessionHealth?: string;
}

interface Props {
  agents: AgentSummaryItem[];
  selectedAgentKey: string;
  selectedTaskOwnerKey?: string;
  planReview: boolean;
  readOnly: boolean;
  agentOptions: AgentDef[];
  onSelect: (agent: AgentSummaryItem) => void;
  onChangeAgentType: (name: string, agentType: string) => void;
}

export const AgentsStrip = ({ agents, selectedAgentKey, selectedTaskOwnerKey, planReview, readOnly, agentOptions, onSelect, onChangeAgentType }: Props) => (
  <div className="agent-team-agent-area" aria-label="Agents">
    <div className="agent-team-agent-area__head"><span className="agent-team-panel-heading__label">Agents</span><strong>{agents.length} agent{agents.length === 1 ? '' : 's'}</strong></div>
    <div className="agent-team-agent-strip">
      {agents.length === 0 ? <div className="agent-team-agent-strip__empty">Agents appear here after the Team Lead proposes a plan.</div> : agents.map((agent) => {
        const editable = planReview && agent.role === 'teammate' && !readOnly;
        return <div key={agent.key} className={`agent-team-summary-agent agent-team-summary-agent--${agent.status}${selectedAgentKey === agent.key ? ' agent-team-summary-agent--selected' : ''}${selectedTaskOwnerKey === agent.key ? ' agent-team-summary-agent--task-owner' : ''}`}>
          <button type="button" className="agent-team-summary-agent__identity" aria-pressed={selectedAgentKey === agent.key} aria-label={`Select ${agent.name}`} onClick={() => onSelect(agent)}>
            <span className="agent-team-summary-agent__name"><span className="agent-team-summary-agent__logo"><AgentIcon id={agent.agentType ?? 'claude-code'} size={14} /></span>{agent.name}</span>
            <span className={`agent-team-detail__status agent-team-detail__status--${agent.status}`}>{agentTeamStatusLabel(agent.status)}{agentSessionHealthSuffix(agent.sessionHealth)}</span>
            {!editable && <span className="agent-team-summary-agent__task">{agent.currentTaskTitle ?? `${agent.taskCount} task${agent.taskCount === 1 ? '' : 's'}`}</span>}
          </button>
          {editable && <div className="agent-team-summary-agent__agent-select"><span className="agent-team-summary-agent__agent-select-label">Coding agent</span><AgentTypeSelect value={agentOptions.some((item) => item.id === agent.agentType) ? agent.agentType! : agentOptions[0].id} options={agentOptions} ariaLabel={`Coding agent for ${agent.name}`} onChange={(id) => onChangeAgentType(agent.name, id)} /></div>}
          <span className="agent-team-summary-agent__stats"><span>Tasks {agent.doneCount}/{agent.taskCount}</span><span>Tools {agent.toolCount ?? '—'}</span><span>Artifacts {agent.artifactCount}</span></span>
        </div>;
      })}
    </div>
  </div>
);
