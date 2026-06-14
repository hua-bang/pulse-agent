export interface AgentDef {
  id: string;
  label: string;
  command: string;
  description: string;
}

export const AGENT_REGISTRY: AgentDef[] = [
  { id: 'claude-code', label: 'Claude Code', command: 'claude', description: 'Anthropic' },
  { id: 'codex', label: 'Codex CLI', command: 'codex', description: 'OpenAI' },
];

export const getAgentCommand = (agentType: string): string | undefined =>
  AGENT_REGISTRY.find(a => a.id === agentType)?.command;
