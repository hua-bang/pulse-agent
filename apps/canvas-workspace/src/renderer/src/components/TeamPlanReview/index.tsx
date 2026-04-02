import { useState } from 'react';
import type { TeamPlanData } from '../../types';

interface Props {
  plan: TeamPlanData;
  planStatus: string;
  onApprove: () => void;
  onReject: (feedback: string) => void;
  onRegenerate: () => void;
}

const TASK_ICON = '\u25CB'; // ○

export const TeamPlanReview = ({ plan, planStatus, onApprove, onReject, onRegenerate }: Props) => {
  const [feedback, setFeedback] = useState('');
  const [activeTab, setActiveTab] = useState<'teammates' | 'tasks'>('teammates');

  if (planStatus === 'generating') {
    return (
      <div className="team-plan-review" onMouseDown={(e) => e.stopPropagation()}>
        <div className="team-plan-header">
          <span className="team-plan-header-icon">&#9881;</span>
          <span>Generating Plan...</span>
        </div>
        <div className="team-plan-loading">
          <div className="team-plan-spinner" />
          <span>AI is analyzing the goal and planning team structure...</span>
        </div>
      </div>
    );
  }

  if (planStatus === 'approved') {
    return (
      <div className="team-plan-review team-plan-review--approved" onMouseDown={(e) => e.stopPropagation()}>
        <div className="team-plan-header">
          <span className="team-plan-header-icon" style={{ color: '#22c55e' }}>&#10003;</span>
          <span>Plan Approved</span>
        </div>
        <div className="team-plan-summary">
          {plan.teammates.length} teammates, {plan.tasks.length} tasks
        </div>
      </div>
    );
  }

  return (
    <div className="team-plan-review" onMouseDown={(e) => e.stopPropagation()}>
      <div className="team-plan-header">
        <span className="team-plan-header-icon">&#128203;</span>
        <span>Team Plan</span>
        <span className="team-plan-badge">{plan.teammates.length} agents, {plan.tasks.length} tasks</span>
      </div>

      <div className="team-plan-tabs">
        <button
          className={`team-plan-tab${activeTab === 'teammates' ? ' team-plan-tab--active' : ''}`}
          onClick={(e) => { e.stopPropagation(); setActiveTab('teammates'); }}
        >
          Teammates ({plan.teammates.length})
        </button>
        <button
          className={`team-plan-tab${activeTab === 'tasks' ? ' team-plan-tab--active' : ''}`}
          onClick={(e) => { e.stopPropagation(); setActiveTab('tasks'); }}
        >
          Tasks ({plan.tasks.length})
        </button>
      </div>

      <div className="team-plan-content">
        {activeTab === 'teammates' && (
          <div className="team-plan-list">
            {plan.teammates.map((t, i) => (
              <div key={i} className="team-plan-teammate">
                <div className="team-plan-teammate-name">{t.name}</div>
                <div className="team-plan-teammate-role">{t.role}</div>
                {t.model && <div className="team-plan-teammate-model">Model: {t.model}</div>}
              </div>
            ))}
          </div>
        )}
        {activeTab === 'tasks' && (
          <div className="team-plan-list">
            {plan.tasks.map((t, i) => (
              <div key={i} className="team-plan-task">
                <div className="team-plan-task-header">
                  <span className="team-plan-task-icon">{TASK_ICON}</span>
                  <span className="team-plan-task-title">{t.title}</span>
                  {t.assignTo && <span className="team-plan-task-assignee">{t.assignTo}</span>}
                </div>
                <div className="team-plan-task-desc">{t.description}</div>
                {t.depNames && t.depNames.length > 0 && (
                  <div className="team-plan-task-deps">
                    Depends on: {t.depNames.join(', ')}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="team-plan-actions">
        <button
          className="agent-btn agent-btn--primary"
          onClick={(e) => { e.stopPropagation(); onApprove(); }}
        >
          &#10003; Approve &amp; Create Agents
        </button>
        <div className="team-plan-reject-row">
          <input
            className="agent-config-input"
            placeholder="Feedback for re-planning..."
            value={feedback}
            onChange={(e) => setFeedback(e.target.value)}
            onMouseDown={(e) => e.stopPropagation()}
          />
          <button
            className="agent-btn agent-btn--secondary"
            onClick={(e) => { e.stopPropagation(); onReject(feedback); setFeedback(''); }}
          >
            Reject
          </button>
        </div>
        <button
          className="team-plan-regenerate-btn"
          onClick={(e) => { e.stopPropagation(); onRegenerate(); }}
        >
          &#8635; Regenerate Plan
        </button>
      </div>
    </div>
  );
};
