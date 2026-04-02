import { useState } from 'react';

interface Props {
  plan: string;
  onApprove: () => void;
  onReject: (feedback: string) => void;
}

export const AgentPlanReview = ({ plan, onApprove, onReject }: Props) => {
  const [feedback, setFeedback] = useState('');

  return (
    <div className="agent-plan-review" onMouseDown={(e) => e.stopPropagation()}>
      <div className="agent-plan-review-header">Plan Review</div>
      <div className="agent-plan-review-content">{plan}</div>
      <div className="agent-plan-review-actions">
        <button
          className="agent-btn agent-btn--primary"
          onClick={(e) => { e.stopPropagation(); onApprove(); }}
        >
          Approve
        </button>
        <div className="agent-plan-review-reject">
          <input
            className="agent-config-input"
            placeholder="Feedback (optional)"
            value={feedback}
            onChange={(e) => setFeedback(e.target.value)}
          />
          <button
            className="agent-btn agent-btn--secondary"
            onClick={(e) => { e.stopPropagation(); onReject(feedback); }}
          >
            Reject
          </button>
        </div>
      </div>
    </div>
  );
};
