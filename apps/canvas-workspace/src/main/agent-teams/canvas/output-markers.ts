import type { ArtifactKind } from 'pulse-coder-agent-teams/runtime';

const ARTIFACT_KINDS = new Set<ArtifactKind>([
  'diff', 'test_log', 'note', 'screenshot', 'file', 'summary', 'other',
]);
const AGENT_TEAM_MARKER_RE =
  /^\s*\[agent-team:(?<kind>plan|human-input-needed|artifact)(?:\s+taskId="(?<taskId>[^"]+)")?(?:\s+kind="(?<artifactKind>[^"]+)")?(?:\s+title="(?<artifactTitle>[^"]+)")?\]\s*(?<text>.*)\s*$/;

export interface AgentOutputMarker {
  kind: 'plan' | 'human-input-needed' | 'artifact';
  taskId?: string;
  artifactKind?: string;
  artifactTitle?: string;
  text: string;
}

export const stripAnsi = (value: string): string =>
  value
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '')
    .replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, '');

export const isPlaceholderHumanInputText = (text: string): boolean =>
  !text
  || text.startsWith('<')
  || /^agent requested human input\.?$/i.test(text)
  || /^human input requested\.?$/i.test(text);

export function parseAgentOutputMarker(line: string): AgentOutputMarker | null {
  const match = AGENT_TEAM_MARKER_RE.exec(stripAnsi(line).trim());
  if (!match?.groups) return null;
  const text = match.groups.text.trim();
  if (/^<[^>]+>$/.test(text)) return null;
  if (match.groups.kind === 'human-input-needed' && isPlaceholderHumanInputText(text)) return null;
  return {
    kind: match.groups.kind as AgentOutputMarker['kind'],
    taskId: match.groups.taskId,
    artifactKind: match.groups.artifactKind,
    artifactTitle: match.groups.artifactTitle,
    text,
  };
}

export function normalizeArtifactKind(value: string | undefined): ArtifactKind {
  if (!value) return 'other';
  return ARTIFACT_KINDS.has(value as ArtifactKind) ? value as ArtifactKind : 'other';
}
