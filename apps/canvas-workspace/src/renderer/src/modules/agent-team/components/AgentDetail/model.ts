import type { AgentNodeData, AgentTeamArtifactRecord, CanvasNode } from '../../../../types';
import type { AgentTeamGraphTask } from '../../model/workspaceModel';
import type { AgentSummaryItem } from '../AgentsStrip';

export interface AgentDetailModel {
  agent: AgentSummaryItem;
  tasks: AgentTeamGraphTask[];
  artifacts: AgentTeamArtifactRecord[];
  agentNode?: CanvasNode;
  activityLines: string[];
  workspaceLabel: string;
}

interface CreateAgentDetailModelOptions {
  agent: AgentSummaryItem;
  tasks: AgentTeamGraphTask[];
  artifacts: AgentTeamArtifactRecord[];
  agentNode?: CanvasNode;
  rootFolder?: string;
}

const terminalLineText = (value: string): string =>
  value
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '')
    .replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, '')
    .replace(/[│┃╭╮╰╯┌┐└┘├┤┬┴┼─━═]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const isLowSignalTerminalLine = (value: string): boolean =>
  !value
  || /^gpt-[\w.-]+/i.test(value)
  || /^>\s*(write tests|explain this codebase|find and fix)/i.test(value)
  || /^\.\.\. \+\d+ lines/i.test(value)
  || /^\+\d+ lines/i.test(value)
  || /^working\b/i.test(value)
  || /^messages to be submitted/i.test(value);

export const recentAgentActivity = (scrollback: string | undefined, limit = 8): string[] => {
  if (!scrollback) return [];
  const seen = new Set<string>();
  return scrollback
    .split('\n')
    .map(terminalLineText)
    .filter((line) => !isLowSignalTerminalLine(line))
    .filter((line) => {
      if (seen.has(line)) return false;
      seen.add(line);
      return true;
    })
    .slice(-limit);
};

export const agentArtifactLabel = (artifact: AgentTeamArtifactRecord): string =>
  artifact.title || artifact.uri || artifact.kind;

export const createAgentDetailModel = ({
  agent,
  tasks,
  artifacts,
  agentNode,
  rootFolder,
}: CreateAgentDetailModelOptions): AgentDetailModel => {
  const agentData = agentNode?.data as AgentNodeData | undefined;
  return {
    agent,
    tasks,
    artifacts,
    agentNode,
    activityLines: recentAgentActivity(agentData?.scrollback),
    workspaceLabel: agentData?.cwd || rootFolder || 'No workspace',
  };
};
