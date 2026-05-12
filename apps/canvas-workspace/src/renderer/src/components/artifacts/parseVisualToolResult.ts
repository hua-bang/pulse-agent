/**
 * Tool-result parsers for the visual / artifact tools.
 *
 * The agent tools (`visual_render`, `artifact_create`, `artifact_update`)
 * return JSON-stringified payloads that the chat renderer detects and
 * inlines as rich UI. This module owns the recognition logic so callers
 * don't sprinkle JSON.parse / shape checks across the codebase.
 */

import type { ArtifactType } from '../../types';
import type { InlineVisualPayload } from './ChatInlineVisual';
import type { ArtifactCardPayload } from './ChatArtifactCard';

export type VisualToolResult =
  | { kind: 'visual_render'; payload: InlineVisualPayload }
  | { kind: 'artifact_create'; payload: ArtifactCardPayload }
  | { kind: 'artifact_update'; payload: ArtifactCardPayload };

interface ParsedShape {
  ok?: boolean;
  kind?: string;
  type?: ArtifactType;
  title?: string;
  content?: string;
  artifactId?: string;
  versionCount?: number;
}

export function parseVisualToolResult(toolName: string, raw?: string): VisualToolResult | null {
  if (!raw) return null;
  let parsed: ParsedShape;
  try {
    parsed = JSON.parse(raw) as ParsedShape;
  } catch {
    return null;
  }
  if (parsed?.ok === false) return null;

  const kind = parsed.kind;
  const name = toolName;

  if ((name === 'visual_render' || kind === 'visual_render') && parsed.type && typeof parsed.content === 'string') {
    return {
      kind: 'visual_render',
      payload: { type: parsed.type, title: parsed.title, content: parsed.content },
    };
  }

  if ((name === 'artifact_create' || kind === 'artifact_create') && parsed.artifactId && parsed.type) {
    return {
      kind: 'artifact_create',
      payload: {
        artifactId: parsed.artifactId,
        title: parsed.title || 'Artifact',
        type: parsed.type,
      },
    };
  }

  if ((name === 'artifact_update' || kind === 'artifact_update') && parsed.artifactId && parsed.type) {
    return {
      kind: 'artifact_update',
      payload: {
        artifactId: parsed.artifactId,
        title: parsed.title || 'Artifact',
        type: parsed.type,
        isUpdate: true,
        versionCount: parsed.versionCount,
      },
    };
  }

  return null;
}
