import { useRef, useState } from 'react';
import type {
  AgentTeamAgentRecord,
  AgentTeamPhase,
  AgentTeamTaskRecord,
  CanvasNode,
} from '../../../../types';
import { NodeMentionPicker } from '../../../node-mentions';
import { useTextareaMention } from '../../../../hooks/useTextareaMention';
import { isImeComposing } from '../../../../utils/ime';

interface TeamCommandProps {
  placement: 'top' | 'lead';
  phase: AgentTeamPhase;
  teamStatus: string;
  lead?: AgentTeamAgentRecord;
  selectedTask?: AgentTeamTaskRecord;
  readOnly?: boolean;
  getAllNodes?: () => CanvasNode[];
  briefLead: (content: string) => Promise<boolean>;
  sendInput: (agentId: string, content: string) => Promise<boolean>;
}

export const TeamCommand = ({
  placement,
  phase,
  teamStatus,
  lead,
  selectedTask,
  readOnly = false,
  getAllNodes,
  briefLead,
  sendInput,
}: TeamCommandProps) => {
  const [briefDraft, setBriefDraft] = useState('');
  const [messageDraft, setMessageDraft] = useState('');
  const [sending, setSending] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const completed = teamStatus === 'completed';
  const mode = phase === 'briefing'
    ? 'brief'
    : phase === 'starting'
      ? 'starting'
      : phase === 'plan_review'
        ? 'revise'
        : completed ? 'next' : 'message';
  const draft = mode === 'brief' ? briefDraft : messageDraft;
  const setDraft = mode === 'brief' ? setBriefDraft : setMessageDraft;
  const mention = useTextareaMention({ textareaRef, value: draft, onChange: setDraft, disabled: readOnly });
  const placeholder = mode === 'brief'
    ? 'Describe the outcome, repo path, constraints, and what this team should handle...'
    : mode === 'starting'
      ? 'Agent terminals are starting before tasks are dispatched...'
      : mode === 'revise'
        ? 'Ask the Lead to adjust the plan — e.g. split a task, add constraints, change scope...'
        : mode === 'next'
          ? 'Describe the next task or follow-up this team should handle...'
          : 'Tell Team Lead what to change...';
  const label = mode === 'brief' ? 'Brief Team Lead'
    : mode === 'starting' ? 'Starting Agents'
      : mode === 'revise' ? 'Revise Plan'
        : mode === 'next' ? 'Next Team Task' : 'Message Team Lead';
  const buttonLabel = mode === 'brief' ? 'Brief'
    : mode === 'starting' ? 'Starting...'
      : mode === 'revise' ? 'Revise'
        : mode === 'next' ? 'Start next task' : 'Send';
  const canSend = mode !== 'starting' && !!draft.trim() && (mode === 'brief' || !!lead);

  const submit = async () => {
    if (!canSend || sending) return;
    setSending(true);
    try {
      if (mode === 'brief') {
        if (await briefLead(briefDraft)) setBriefDraft('');
        return;
      }
      if (!lead) return;
      const revisePrefix = mode === 'revise'
        ? 'The user wants to revise the current plan before approving it. Regenerate the plan incorporating this feedback:\n\n'
        : '';
      const taskContext = !revisePrefix && !completed && selectedTask
        ? `Task context: "${selectedTask.title}" (${selectedTask.status}).\n`
        : '';
      if (await sendInput(lead.id, `${revisePrefix}${taskContext}${messageDraft.trim()}`)) {
        setMessageDraft('');
      }
    } finally {
      setSending(false);
    }
  };

  return (
    <div className={`agent-team-command agent-team-command--${placement}`} aria-label="Team command">
      {mention.pickerOpen && (
        <NodeMentionPicker nodes={getAllNodes?.() ?? []} onSelect={mention.handleSelect} onClose={mention.handleClose} />
      )}
      <div className="agent-team-command__copy">
        <span className="agent-team-command__label">{label}</span>
        {mode === 'message' && selectedTask && (
          <span className={`agent-team-command__task-chip agent-team-command__task-chip--${selectedTask.status}`}>
            Task · {selectedTask.title}
          </span>
        )}
        <textarea
          ref={textareaRef}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (isImeComposing(event) || mention.handleKeyDown(event)) return;
            const shouldSend = event.key === 'Enter'
              && (mode === 'brief' ? event.metaKey || event.ctrlKey : !event.shiftKey);
            if (shouldSend) { event.preventDefault(); void submit(); }
          }}
          placeholder={placeholder}
          disabled={readOnly}
          rows={mode === 'brief' ? 8 : mode === 'revise' || mode === 'next' ? 3 : 1}
        />
      </div>
      <button type="button" onClick={() => void submit()} disabled={readOnly || !canSend || sending}>
        {sending ? 'Sending…' : buttonLabel}
      </button>
    </div>
  );
};
