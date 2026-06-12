/**
 * Right-dock tab content that previews one artifact with live updates and
 * a pin-to-canvas control. Tab chrome (label, close, switching) lives in
 * components/RightDock; the loaded artifact's title is reported up via
 * `onTitleChange` so the tab label tracks renames.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Artifact, ArtifactVersion } from '../../types';
import { renderMermaidSource, type MermaidRenderResult } from '../chat/utils/mermaid';

const TYPE_LABEL: Record<string, string> = {
  html: 'HTML',
  svg: 'SVG',
  mermaid: 'Mermaid',
};

interface ArtifactTabViewProps {
  workspaceId: string;
  artifactId: string;
  onTitleChange?: (title: string) => void;
}

export const ArtifactTabView = ({ workspaceId, artifactId, onTitleChange }: ArtifactTabViewProps) => {
  const [artifact, setArtifact] = useState<Artifact | null>(null);
  const [pinning, setPinning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load + subscribe for the lifetime of the (workspace, artifact) pair.
  useEffect(() => {
    let cancelled = false;
    setArtifact(null);
    setError(null);

    const refresh = async () => {
      const result = await window.canvasWorkspace.artifacts.get(workspaceId, artifactId);
      if (cancelled) return;
      if (!result?.ok || !result.artifact) {
        setError(result?.error ?? 'Artifact not found');
        setArtifact(null);
        return;
      }
      setArtifact(result.artifact);
    };

    void refresh();

    const unsubscribe = window.canvasWorkspace.artifacts.onChange((event) => {
      if (event.workspaceId !== workspaceId) return;
      if (event.artifactId !== artifactId) return;
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
  }, [workspaceId, artifactId]);

  const onTitleChangeRef = useRef(onTitleChange);
  onTitleChangeRef.current = onTitleChange;
  const title = artifact?.title;
  useEffect(() => {
    if (title) onTitleChangeRef.current?.(title);
  }, [title]);

  const viewedVersion: ArtifactVersion | null = useMemo(() => {
    if (!artifact) return null;
    return (
      artifact.versions.find(v => v.id === artifact.currentVersionId)
      ?? artifact.versions[artifact.versions.length - 1]
      ?? null
    );
  }, [artifact]);

  const handlePin = useCallback(async () => {
    if (!artifact || artifact.pinnedNodeId || pinning) return;
    setPinning(true);
    try {
      const result = await window.canvasWorkspace.artifacts.pinToCanvas(workspaceId, artifactId, {});
      if (!result.ok) setError(result.error ?? 'Pin failed');
    } finally {
      setPinning(false);
    }
  }, [workspaceId, artifactId, artifact, pinning]);

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
    if (artifact.type === 'mermaid') {
      return (
        <ArtifactMermaid
          key={viewedVersion.id}
          source={viewedVersion.content}
        />
      );
    }
    return <div className="artifact-drawer__empty">Unsupported artifact type</div>;
  };

  return (
    <>
      {artifact && (
        <div className="artifact-drawer__toolbar">
          <span className="artifact-drawer__type-badge">{TYPE_LABEL[artifact.type] ?? artifact.type}</span>
          <div className="artifact-drawer__toolbar-spacer" />
          {artifact.versions.length > 0 && (
            artifact.pinnedNodeId ? (
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
            )
          )}
        </div>
      )}
      <div className="artifact-drawer__body">{renderBody()}</div>
    </>
  );
};

const ArtifactMermaid = ({ source }: { source: string }) => {
  const [result, setResult] = useState<MermaidRenderResult | null>(null);
  useEffect(() => {
    let cancelled = false;
    setResult(null);
    void renderMermaidSource(source).then(r => {
      if (!cancelled) setResult(r);
    });
    return () => { cancelled = true; };
  }, [source]);

  if (!result) {
    return <div className="artifact-drawer__mermaid-host artifact-drawer__mermaid-host--loading">Rendering diagram…</div>;
  }
  if (!result.ok) {
    return (
      <div className="artifact-drawer__mermaid-host artifact-drawer__mermaid-host--error">
        <div className="artifact-drawer__mermaid-error-title">Mermaid render failed</div>
        <pre className="artifact-drawer__mermaid-error-detail">{result.error}</pre>
      </div>
    );
  }
  return (
    <div
      className="artifact-drawer__mermaid-host"
      dangerouslySetInnerHTML={{ __html: result.svg }}
    />
  );
};
