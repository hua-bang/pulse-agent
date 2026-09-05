import { describe, expect, it } from 'vitest';
import { normalizeArtifactKind, parseAgentOutputMarker } from './output-markers';

describe('agent team output markers', () => {
  it('parses ANSI-wrapped artifact metadata and text', () => {
    expect(parseAgentOutputMarker(
      '\u001b[32m[agent-team:artifact taskId="t1" kind="diff" title="Patch"] done\u001b[0m',
    )).toEqual({
      kind: 'artifact',
      taskId: 't1',
      artifactKind: 'diff',
      artifactTitle: 'Patch',
      text: 'done',
    });
  });

  it('rejects echoed human-input placeholders', () => {
    expect(parseAgentOutputMarker('[agent-team:human-input-needed taskId="t1"] <question>')).toBeNull();
    expect(parseAgentOutputMarker('[agent-team:human-input-needed] Agent requested human input.')).toBeNull();
  });

  it('keeps only supported artifact kinds', () => {
    expect(normalizeArtifactKind('screenshot')).toBe('screenshot');
    expect(normalizeArtifactKind('unknown')).toBe('other');
    expect(normalizeArtifactKind(undefined)).toBe('other');
  });
});
