/**
 * Right-side drawer that previews an artifact with version history and
 * pin-to-canvas control.
 *
 * Driven by `ArtifactDrawerContext` — any component that calls
 * `openArtifact(workspaceId, artifactId)` causes this drawer to mount
 * and load the requested artifact.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Artifact, ArtifactVersion } from '../../types';
import { useArtifactDrawer } from './ArtifactContext';

const TYPE_LABEL: Record<string, string> = {
  html: 'HTML',
  svg: 'SVG',
  mermaid: 'Mermaid',
};

export const ArtifactDrawer = () => {
  const { open, close } = useArtifactDrawer();
  const [artifact, setArtifact] = useState<Artifact | null>(null);
  const [viewVersionId, setViewVersionId] = useState<string | null>(null);
  const [pinning, setPinning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load + subscribe whenever the opened (workspace, artifact) pair changes.
  useEffect(() => {
    if (!open) {
      setArtifact(null);
      setViewVersionId(null);
      setError(null);
      return;
    }
    let cancelled = false;
    setError(null);

    const refresh = async () => {
      const result = await window.canvasWorkspace.artifacts.get(open.workspaceId, open.artifactId);
      if (cancelled) return;
      if (!result?.ok || !result.artifact) {
        setError(result?.error ?? 'Artifact not found');
        setArtifact(null);
        return;
      }
      setArtifact(result.artifact);
      // On first load (or when the artifact gets a new version), snap to current.
      setViewVersionId(prev => {
        if (!prev) return result.artifact!.currentVersionId;
        const stillExists = result.artifact!.versions.some(v => v.id === prev);
        return stillExists ? prev : result.artifact!.currentVersionId;
      });
    };

    void refresh();

    const unsubscribe = window.canvasWorkspace.artifacts.onChange((event) => {
      if (event.workspaceId !== open.workspaceId) return;
      if (event.artifactId !== open.artifactId) return;
      if (event.kind === 'delete') {
        setArtifact(null);
        setError('Artifact was deleted');
        return;
      }
      void refresh();
    });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [open]);

  const viewedVersion: ArtifactVersion | null = useMemo(() => {
    if (!artifact) return null;
    const id = viewVersionId ?? artifact.currentVersionId;
    return artifact.versions.find(v => v.id === id) ?? artifact.versions[artifact.versions.length - 1] ?? null;
  }, [artifact, viewVersionId]);

  const handlePin = useCallback(async () => {
    if (!open || !artifact || artifact.pinnedNodeId || pinning) return;
    setPinning(true);
    try {
      const result = await window.canvasWorkspace.artifacts.pinToCanvas(open.workspaceId, open.artifactId, {});
      if (!result.ok) setError(result.error ?? 'Pin failed');
    } finally {
      setPinning(false);
    }
  }, [open, artifact, pinning]);

  // Close on Escape.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, close]);

  if (!open) return null;

  const renderBody = () => {
    if (error) {
      return <div className="artifact-drawer__empty">{error}</div>;
    }
    if (!artifact || !viewedVersion) {
      return <div className="artifact-drawer__empty">Loading…</div>;
    }
    if (artifact.type === 'html') {
      return (
        <iframe
          key={viewedVersion.id}
          className="artifact-drawer__frame"
          srcDoc={viewedVersion.content}
          sandbox="allow-scripts"
          title={artifact.title}
        />
      );
    }
    if (artifact.type === 'svg') {
      return (
        <div
          className="artifact-drawer__svg-host"
          dangerouslySetInnerHTML={{ __html: viewedVersion.content }}
        />
      );
    }
    return <div className="artifact-drawer__empty">Unsupported artifact type</div>;
  };

  return (
    <>
      <div className="artifact-drawer-backdrop" onClick={close} />
      <aside className="artifact-drawer" role="dialog" aria-label="Artifact preview">
        <div className="artifact-drawer__header">
          <div className="artifact-drawer__title" title={artifact?.title}>
            {artifact?.title ?? 'Artifact'}
          </div>
          {artifact && (
            <span className="artifact-drawer__type-badge">{TYPE_LABEL[artifact.type] ?? artifact.type}</span>
          )}
          <button type="button" className="artifact-drawer__close" onClick={close} aria-label="Close">
            ×
          </button>
        </div>
        {artifact && artifact.versions.length > 0 && (
          <div className="artifact-drawer__toolbar">
            <select
              className="artifact-drawer__version-select"
              value={viewVersionId ?? artifact.currentVersionId}
              onChange={(e) => setViewVersionId(e.target.value)}
            >
              {artifact.versions.map((version, i) => (
                <option key={version.id} value={version.id}>
                  v{i + 1}{version.id === artifact.currentVersionId ? ' (current)' : ''}
                </option>
              ))}
            </select>
            <div className="artifact-drawer__toolbar-spacer" />
            {artifact.pinnedNodeId ? (
              <span className="artifact-drawer__pinned-badge">Pinned to canvas</span>
            ) : (
              <button
                type="button"
                className="artifact-drawer__action artifact-drawer__action--primary"
                onClick={() => void handlePin()}
                disabled={pinning}
              >
                {pinning ? 'Pinning…' : 'Pin to canvas'}
              </button>
            )}
          </div>
        )}
        <div className="artifact-drawer__body">{renderBody()}</div>
      </aside>
    </>
  );
};
