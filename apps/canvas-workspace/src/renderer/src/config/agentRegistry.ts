export interface AgentDef {
  id: string;
  label: string;
  command: string;
  icon: string;
  description: string;
}

export const AGENT_REGISTRY: AgentDef[] = [
  { id: 'claude-code', label: 'Claude Code', command: 'claude', icon: '\u{1F916}', description: 'Anthropic Claude Code agent' },
  { id: 'codex', label: 'Codex', command: 'codex', icon: '\u{1F9E0}', description: 'OpenAI Codex CLI agent' },
  { id: 'pulse-coder', label: 'Pulse Coder', command: 'pulse-coder', icon: '\u26A1', description: 'Pulse Coder agent' },
];

export const getAgentCommand = (agentType: string): string | undefined =>
  AGENT_REGISTRY.find(a => a.id === agentType)?.command;
