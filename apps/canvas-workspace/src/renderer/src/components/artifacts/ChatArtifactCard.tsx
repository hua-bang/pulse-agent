/**
 * Compact in-chat representation of a stored artifact.
 *
 * Source: `artifact_create` / `artifact_update` tool result. Clicking the
 * card opens the artifact in a right-dock tab; the "Pin to Canvas"
 * shortcut promotes the artifact to a spatial canvas node in one click.
 */

import { useCallback, useEffect, useState } from 'react';
import { useI18n } from '../../i18n';
import type { Artifact, ArtifactType } from '../../types';
import { useRightDock } from '../RightDock';

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
  const { openArtifact } = useRightDock();
  const { t } = useI18n();
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

  const handlePin = useCallback(async () => {
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
    ? t('artifactCard.iterated', { version: payload.versionCount ?? '?' })
    : t('artifactCard.new', { type: payload.type.toUpperCase() });

  return (
    <article className="chat-artifact-card">
      <div className="chat-artifact-card__row">
        <button
          type="button"
          className="chat-artifact-card__main"
          aria-label={t('artifactCard.openLabel', { title: payload.title })}
          onClick={handleOpen}
        >
          <span className="chat-artifact-card__icon">{TYPE_ICONS[payload.type] ?? '▣'}</span>
          <span className="chat-artifact-card__meta">
            <span className="chat-artifact-card__title">{payload.title}</span>
            <span className="chat-artifact-card__sub">
              {subtitle}{pinnedNodeId ? ` · ${t('artifactCard.pinned')}` : ''}
            </span>
          </span>
        </button>
        <div className="chat-artifact-card__actions">
          <button
            type="button"
            className="chat-artifact-card__action"
            onClick={handleOpen}
          >
            {t('artifactCard.open')}
          </button>
          <button
            type="button"
            className="chat-artifact-card__action"
            onClick={() => void handlePin()}
            disabled={!!pinnedNodeId || pinning}
          >
            {pinnedNodeId
              ? t('artifactCard.pinned')
              : pinning
                ? t('artifactCard.pinning')
                : t('artifactCard.pinToCanvas')}
          </button>
        </div>
      </div>
    </article>
  );
};
