import { useState, useCallback, useRef, useEffect } from 'react';
import type { CanvasNode, FrameNodeData, AgentNodeData } from '../../types';

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
  actions?: AgentAction[];
}

interface AgentAction {
  type: 'create_team' | 'plan_team' | 'run_team' | 'info';
  label: string;
  payload?: Record<string, unknown>;
  executed?: boolean;
}

interface Props {
  open: boolean;
  onToggle: () => void;
  nodes: CanvasNode[];
  onCreateTeamFrame?: (name: string, goal: string) => void;
  onPlanTeam?: (frameId: string) => void;
}

export const WorkspaceAgent = ({ open, onToggle, nodes, onCreateTeamFrame, onPlanTeam }: Props) => {
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: 'welcome',
      role: 'assistant',
      content: 'Hi! I\'m your workspace agent. I can help you create and manage agent teams. Tell me what you\'d like to accomplish, and I\'ll help organize it.',
      timestamp: Date.now(),
    },
  ]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const getWorkspaceSummary = useCallback(() => {
    const teamFrames = nodes.filter(
      (n) => n.type === 'frame' && (n.data as FrameNodeData).isTeam
    );
    const agentNodes = nodes.filter((n) => n.type === 'agent');
    const runningAgents = agentNodes.filter(
      (n) => (n.data as AgentNodeData).status === 'running'
    );

    return {
      totalNodes: nodes.length,
      teams: teamFrames.length,
      agents: agentNodes.length,
      runningAgents: runningAgents.length,
      teamDetails: teamFrames.map((f) => {
        const fd = f.data as FrameNodeData;
        return {
          name: fd.teamName || f.title,
          status: fd.teamStatus || 'idle',
          goal: fd.goal || 'No goal set',
          id: f.id,
        };
      }),
    };
  }, [nodes]);

  const handleSend = useCallback(async () => {
    if (!input.trim() || loading) return;

    const userMsg: ChatMessage = {
      id: `msg-${Date.now()}`,
      role: 'user',
      content: input.trim(),
      timestamp: Date.now(),
    };
    setMessages((prev) => [...prev, userMsg]);
    setInput('');
    setLoading(true);

    try {
      const api = window.canvasWorkspace?.agentTeam;
      if (!api) {
        throw new Error('Agent team API not available');
      }

      // Build context-aware prompt
      const summary = getWorkspaceSummary();
      const systemContext = [
        `Workspace state: ${summary.totalNodes} nodes, ${summary.teams} teams, ${summary.agents} agents (${summary.runningAgents} running).`,
        summary.teamDetails.length > 0
          ? `Teams: ${summary.teamDetails.map((t) => `"${t.name}" (${t.status}) - ${t.goal}`).join('; ')}`
          : 'No teams yet.',
      ].join('\n');

      // Use planTeam as a lightweight way to get AI response
      // In a full implementation, this would be a dedicated workspace agent LLM call
      const response = await processUserMessage(input.trim(), systemContext, summary);

      const assistantMsg: ChatMessage = {
        id: `msg-${Date.now()}-reply`,
        role: 'assistant',
        content: response.content,
        timestamp: Date.now(),
        actions: response.actions,
      };
      setMessages((prev) => [...prev, assistantMsg]);
    } catch {
      setMessages((prev) => [
        ...prev,
        {
          id: `msg-${Date.now()}-error`,
          role: 'system',
          content: 'Failed to process request. Please try again.',
          timestamp: Date.now(),
        },
      ]);
    } finally {
      setLoading(false);
    }
  }, [input, loading, getWorkspaceSummary]);

  const handleAction = useCallback(
    (msgId: string, actionIndex: number) => {
      setMessages((prev) =>
        prev.map((m) => {
          if (m.id !== msgId || !m.actions) return m;
          const actions = [...m.actions];
          const action = actions[actionIndex];
          if (action.executed) return m;

          actions[actionIndex] = { ...action, executed: true };

          switch (action.type) {
            case 'create_team':
              onCreateTeamFrame?.(
                (action.payload?.name as string) || 'New Team',
                (action.payload?.goal as string) || ''
              );
              break;
            case 'plan_team':
              if (action.payload?.frameId) {
                onPlanTeam?.(action.payload.frameId as string);
              }
              break;
          }

          return { ...m, actions };
        })
      );
    },
    [onCreateTeamFrame, onPlanTeam]
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend]
  );

  if (!open) {
    return (
      <button className="workspace-agent-fab" onClick={onToggle} title="Workspace Agent">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
          <circle cx="12" cy="8" r="4" stroke="currentColor" strokeWidth="1.5" />
          <path d="M4 20c0-4.4 3.6-8 8-8s8 3.6 8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          <circle cx="12" cy="8" r="1.5" fill="currentColor" />
        </svg>
      </button>
    );
  }

  return (
    <aside className="workspace-agent-panel">
      <div className="workspace-agent-header">
        <div className="workspace-agent-header-left">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
            <circle cx="12" cy="8" r="4" stroke="currentColor" strokeWidth="1.5" />
            <path d="M4 20c0-4.4 3.6-8 8-8s8 3.6 8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
          <span className="workspace-agent-title">Workspace Agent</span>
        </div>
        <button className="workspace-agent-close" onClick={onToggle}>
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <path d="M3 3l8 8M11 3l-8 8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
          </svg>
        </button>
      </div>

      <div className="workspace-agent-status">
        {(() => {
          const s = getWorkspaceSummary();
          return `${s.teams} team${s.teams !== 1 ? 's' : ''} \u00B7 ${s.agents} agent${s.agents !== 1 ? 's' : ''} \u00B7 ${s.runningAgents} running`;
        })()}
      </div>

      <div className="workspace-agent-messages">
        {messages.map((msg) => (
          <div key={msg.id} className={`workspace-agent-msg workspace-agent-msg--${msg.role}`}>
            <div className="workspace-agent-msg-content">{msg.content}</div>
            {msg.actions && msg.actions.length > 0 && (
              <div className="workspace-agent-msg-actions">
                {msg.actions.map((action, i) => (
                  <button
                    key={i}
                    className={`workspace-agent-action-btn${action.executed ? ' workspace-agent-action-btn--done' : ''}`}
                    onClick={() => handleAction(msg.id, i)}
                    disabled={action.executed}
                  >
                    {action.executed ? '\u2713 ' : ''}{action.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        ))}
        {loading && (
          <div className="workspace-agent-msg workspace-agent-msg--assistant">
            <div className="workspace-agent-typing">
              <span /><span /><span />
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      <div className="workspace-agent-input-area">
        <textarea
          ref={inputRef}
          className="workspace-agent-input"
          placeholder="Describe your goal..."
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          rows={2}
        />
        <button
          className="workspace-agent-send"
          onClick={handleSend}
          disabled={!input.trim() || loading}
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path d="M2 8l12-5-5 12-2-5-5-2z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
          </svg>
        </button>
      </div>
    </aside>
  );
};

/* ---- Local message processing ---- */

interface ProcessedResponse {
  content: string;
  actions?: AgentAction[];
}

async function processUserMessage(
  userInput: string,
  _systemContext: string,
  summary: ReturnType<() => { totalNodes: number; teams: number; agents: number; runningAgents: number; teamDetails: Array<{ name: string; status: string; goal: string; id: string }> }>
): Promise<ProcessedResponse> {
  const lower = userInput.toLowerCase();

  // Simple intent detection — in production this would be an LLM call
  if (lower.includes('status') || lower.includes('how') && lower.includes('team')) {
    if (summary.teams === 0) {
      return {
        content: 'No teams in this workspace yet. Would you like to create one? Just tell me what you want to accomplish.',
      };
    }
    const teamStatus = summary.teamDetails
      .map((t) => `- **${t.name}**: ${t.status} — ${t.goal}`)
      .join('\n');
    return {
      content: `Here's the current workspace status:\n\n${teamStatus}\n\n${summary.runningAgents} agent(s) currently running.`,
    };
  }

  if (lower.includes('create') && lower.includes('team')) {
    const teamName = extractTeamName(userInput) || 'New Team';
    return {
      content: `I'll create a team called "${teamName}". Click the button below to add it to the canvas.`,
      actions: [
        {
          type: 'create_team',
          label: `Create "${teamName}" Team`,
          payload: { name: teamName, goal: userInput },
        },
      ],
    };
  }

  if (lower.includes('plan') && summary.teams > 0) {
    const actions: AgentAction[] = summary.teamDetails
      .filter((t) => t.status === 'idle' && t.goal)
      .map((t) => ({
        type: 'plan_team' as const,
        label: `Plan "${t.name}"`,
        payload: { frameId: t.id },
      }));
    if (actions.length > 0) {
      return {
        content: 'I can generate AI plans for your idle teams. Click a button below to start planning.',
        actions,
      };
    }
  }

  // Default: interpret as a goal and suggest creating a team
  const suggestedName = extractTeamName(userInput) || 'Task Team';
  return {
    content: `I understand you want to: "${userInput}"\n\nI can create a team to work on this. The team will be set up with a goal, and you can use AI Planning to automatically generate the right agents and tasks.`,
    actions: [
      {
        type: 'create_team',
        label: `Create Team for This Goal`,
        payload: { name: suggestedName, goal: userInput },
      },
    ],
  };
}

function extractTeamName(input: string): string | null {
  // Try to extract a team name from quotes
  const quoted = input.match(/"([^"]+)"/);
  if (quoted) return quoted[1];

  // Try to extract from "called X" pattern
  const called = input.match(/called\s+(\w[\w\s]{0,20})/i);
  if (called) return called[1].trim();

  return null;
}
