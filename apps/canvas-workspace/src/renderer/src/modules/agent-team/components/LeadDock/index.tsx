import type { ReactNode } from 'react';
import './index.css';
import type { AgentTeamAgentRecord, AgentTeamPhase, AgentTeamStatus, CanvasNode } from '../../../../types';
import { AgentNodeBody } from '../../../coding-agent/surface';
import type { AgentTerminalSurface } from '../AgentDetail';
import { agentSessionHealthSuffix, agentTeamStatusLabel } from '../visualLabels';

interface LeadDockProps {
  lead?: AgentTeamAgentRecord;
  leadNode?: CanvasNode;
  leadNodeId?: string;
  phase: AgentTeamPhase;
  teamStatus: AgentTeamStatus;
  sessionHealth?: string;
  currentTaskTitle?: string;
  selectedTaskTitle?: string;
  commandSlot?: ReactNode;
  terminal: AgentTerminalSurface;
}

export const LeadDock = ({
  lead,
  leadNode,
  leadNodeId,
  phase,
  teamStatus,
  sessionHealth,
  currentTaskTitle,
  selectedTaskTitle,
  commandSlot,
  terminal,
}: LeadDockProps) => (
  <section className="agent-team-lead-dock" aria-label="Team Lead">
    <div className="agent-team-lead-dock__head">
      <strong>{lead?.name ?? 'Team Lead'}</strong>
      <span className={`agent-team-detail__status agent-team-detail__status--${lead?.status ?? 'idle'}`}>
        {agentTeamStatusLabel(lead?.status ?? 'idle')}{agentSessionHealthSuffix(sessionHealth)}
      </span>
    </div>
    <div className="agent-team-lead-dock__body">
      {leadNode ? (
        <div className="agent-team-lead-dock__agent-surface">
          <AgentNodeBody node={leadNode} {...terminal} teamLeadBriefSlot={commandSlot} agentTeamStatus={teamStatus} forceTeamWarmup={phase === 'starting'} />
        </div>
      ) : (
        <>
          <div className="agent-team-lead-dock__current">
            <span className="agent-team-detail__section-title">Current focus</span>
            <strong>{phase === 'briefing' ? 'Clarify scope and propose a plan' : currentTaskTitle ?? selectedTaskTitle ?? 'Coordinate team execution'}</strong>
            <span>{phase === 'plan_review' ? 'Review the graph and send feedback to revise. Approve when the plan looks right.' : phase === 'executing' ? 'Send normal changes to the lead and let the lead route work to the right teammate.' : 'Tell the lead what outcome, repo path, constraints, and teammate split you expect.'}</span>
          </div>
          <div className="agent-team-lead-dock__meta">
            <span>Provider</span>
            <strong>{lead?.sessionRef?.displayName ?? lead?.sessionRef?.provider ?? 'Coding Agent'}</strong>
            {leadNodeId && <code>{leadNodeId}</code>}
          </div>
          {commandSlot}
        </>
      )}
    </div>
  </section>
);
