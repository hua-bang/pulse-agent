export type ArtifactMemoryKind = 'preference' | 'fact' | 'decision' | 'rule' | 'note';
export type ArtifactMemoryScope =
  | { kind: 'global' }
  | { kind: 'workspace'; workspaceId: string };
export type ArtifactSkillScope =
  | { level: 'global' }
  | { level: 'workspace'; workspaceId: string };

export interface ArtifactAgentWritePort {
  saveMemory: (
    scope: ArtifactMemoryScope,
    content: string,
    kind: ArtifactMemoryKind,
  ) => Promise<void>;
  saveSkill: (
    scope: ArtifactSkillScope,
    skill: { name: string; description: string; body: string },
  ) => Promise<void>;
}

let writePort: ArtifactAgentWritePort | null = null;

export function setArtifactAgentWritePort(port: ArtifactAgentWritePort): void {
  writePort = port;
}

export function getArtifactAgentWritePort(): ArtifactAgentWritePort {
  if (!writePort) throw new Error('Artifact Agent write integration is unavailable.');
  return writePort;
}
