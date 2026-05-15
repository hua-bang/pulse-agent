/**
 * Compact in-chat representation of a stored artifact.
 *
 * Source: `artifact_create` / `artifact_update` tool result. Clicking the
 * card opens the side drawer; the "Pin to Canvas" shortcut promotes the
 * artifact to a spatial canvas node in one click.
 */

import { useCallback, useEffect, useState } from 'react';
import type { Artifact, ArtifactType } from '../../types';
import { useArtifactDrawer } from './ArtifactContext';

export interface ArtifactCardPayload {
  artifactId: string;
  title: string;
  type: ArtifactType;
  /** True when this card represents an iteration (artifact_update), not the original create. */
  isUpdate?: boolean;
  versionCount?: number;
}

interface ChatArtifactCardProps {
  workspaceId: string;
  payload: ArtifactCardPayload;
}

const TYPE_ICONS: Record<ArtifactType, string> = {
  html: '▣',
  svg: '◇',
  mermaid: '⇄',
};

export const ChatArtifactCard = ({ workspaceId, payload }: ChatArtifactCardProps) => {
  const { openArtifact } = useArtifactDrawer();
  const [pinnedNodeId, setPinnedNodeId] = useState<string | null>(null);
  const [pinning, setPinning] = useState(false);

  // Resolve initial pinned state from the artifact (in case it was pinned earlier).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const result = await window.canvasWorkspace.artifacts.get(workspaceId, payload.artifactId);
      if (cancelled) return;
      const artifact = (result?.ok ? result.artifact : undefined) as Artifact | undefined;
      if (artifact?.pinnedNodeId) setPinnedNodeId(artifact.pinnedNodeId);
    })();
    return () => { cancelled = true; };
  }, [workspaceId, payload.artifactId]);

  const handleOpen = useCallback(() => {
    openArtifact(workspaceId, payload.artifactId);
  }, [openArtifact, workspaceId, payload.artifactId]);

  const handlePin = useCallback(async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (pinnedNodeId || pinning) return;
    setPinning(true);
    try {
      const result = await window.canvasWorkspace.artifacts.pinToCanvas(workspaceId, payload.artifactId, {});
      if (result.ok && result.nodeId) {
        setPinnedNodeId(result.nodeId);
      }
    } finally {
      setPinning(false);
    }
  }, [pinnedNodeId, pinning, workspaceId, payload.artifactId]);

  const subtitle = payload.isUpdate
    ? `Iterated · v${payload.versionCount ?? '?'}`
    : `New artifact · ${payload.type.toUpperCase()}`;

  return (
    <div
      className="chat-artifact-card"
      role="button"
      tabIndex={0}
      onClick={handleOpen}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          handleOpen();
        }
      }}
    >
      <div className="chat-artifact-card__row">
        <div className="chat-artifact-card__icon">{TYPE_ICONS[payload.type] ?? '▣'}</div>
        <div className="chat-artifact-card__meta">
          <div className="chat-artifact-card__title">{payload.title}</div>
          <div className="chat-artifact-card__sub">{subtitle}{pinnedNodeId ? ' · pinned' : ''}</div>
        </div>
        <div className="chat-artifact-card__actions">
          <button
            type="button"
            className="chat-artifact-card__action"
            onClick={(e) => { e.stopPropagation(); handleOpen(); }}
          >
            Open
          </button>
          <button
            type="button"
            className="chat-artifact-card__action"
            onClick={(e) => void handlePin(e)}
            disabled={!!pinnedNodeId || pinning}
          >
            {pinnedNodeId ? 'Pinned' : pinning ? 'Pinning…' : 'Pin to canvas'}
          </button>
        </div>
      </div>
    </div>
  );
};
