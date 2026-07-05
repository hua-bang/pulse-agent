import { useEffect, useState } from 'react';
import type { Artifact } from '../../types';

interface UseIframeArtifactOptions {
  artifactId: string | null;
  isArtifactMode: boolean;
  workspaceId?: string;
}

export const useIframeArtifact = ({
  artifactId,
  isArtifactMode,
  workspaceId,
}: UseIframeArtifactOptions) => {
  const [artifact, setArtifact] = useState<Artifact | null>(null);

  useEffect(() => {
    if (!isArtifactMode || !workspaceId || !artifactId) {
      setArtifact(null);
      return;
    }
    let cancelled = false;
    const refresh = async () => {
      const result = await window.canvasWorkspace.artifacts.get(workspaceId, artifactId);
      if (cancelled) return;
      setArtifact((result?.ok ? result.artifact : null) ?? null);
    };
    void refresh();
    const unsubscribe = window.canvasWorkspace.artifacts.onChange((event) => {
      if (event.workspaceId !== workspaceId) return;
      if (event.artifactId !== artifactId) return;
      if (event.kind === 'delete') {
        setArtifact(null);
        return;
      }
      void refresh();
    });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [isArtifactMode, workspaceId, artifactId]);

  const version = artifact?.versions.find((item) => item.id === artifact.currentVersionId)
    ?? artifact?.versions[artifact.versions.length - 1];

  return {
    artifact,
    artifactHtml: version?.content ?? '',
  };
};
