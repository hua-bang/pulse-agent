/**
 * Right-dock panel that previews an artifact with version history and
 * pin-to-canvas control.
 *
 * Driven by `ArtifactDrawerContext` — any component that calls
 * `openArtifact(workspaceId, artifactId)` causes this panel to mount
 * and load the requested artifact. Positioning, resizing, layering and
 * exclusivity against other dock panels live in RightDockPanel.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Artifact, ArtifactVersion } from '../../types';
import { useArtifactDrawer, type OpenArtifactRef } from './ArtifactContext';
import { renderMermaidSource, type MermaidRenderResult } from '../chat/utils/mermaid';
import { RightDockPanel } from '../RightDock';

const TYPE_LABEL: Record<string, string> = {
  html: 'HTML',
  svg: 'SVG',
  mermaid: 'Mermaid',
};

const WIDTH_STORAGE_KEY = 'canvas-workspace:artifact-drawer-width';
const MIN_DRAWER_WIDTH = 360;
const DEFAULT_DRAWER_WIDTH = 640;

export const ArtifactDrawer = () => {
  const { open, close } = useArtifactDrawer();
  // Retain the last-opened ref while the dock's exit animation plays so
  // the content doesn't vanish mid-slide; cleared in onExited.
  const [retained, setRetained] = useState<OpenArtifactRef | null>(null);
  useEffect(() => {
    if (open) setRetained(open);
  }, [open]);
  const shown = open ?? retained;

  const [artifact, setArtifact] = useState<Artifact | null>(null);
  const [pinning, setPinning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load + subscribe whenever the shown (workspace, artifact) pair changes.
  useEffect(() => {
    if (!shown) {
      setArtifact(null);
      setError(null);
      return;
    }
    let cancelled = false;
    setError(null);

    const refresh = async () => {
      const result = await window.canvasWorkspace.artifacts.get(shown.workspaceId, shown.artifactId);
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
      if (event.workspaceId !== shown.workspaceId) return;
      if (event.artifactId !== shown.artifactId) return;
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
  }, [shown]);

  const viewedVersion: ArtifactVersion | null = useMemo(() => {
    if (!artifact) return null;
    return (
      artifact.versions.find(v => v.id === artifact.currentVersionId)
      ?? artifact.versions[artifact.versions.length - 1]
      ?? null
    );
  }, [artifact]);

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

  const handleExited = useCallback(() => setRetained(null), []);

  if (!shown) return null;

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
        <ArtifactDrawerMermaid
          key={viewedVersion.id}
          source={viewedVersion.content}
        />
      );
    }
    return <div className="artifact-drawer__empty">Unsupported artifact type</div>;
  };

  return (
    <RightDockPanel
      panelId="artifact"
      open={open !== null}
      ariaLabel="Artifact preview"
      className="artifact-drawer"
      defaultWidth={DEFAULT_DRAWER_WIDTH}
      minWidth={MIN_DRAWER_WIDTH}
      maxViewportRatio={0.95}
      widthStorageKey={WIDTH_STORAGE_KEY}
      onCloseRequest={close}
      onExited={handleExited}
    >
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
    </RightDockPanel>
  );
};

const ArtifactDrawerMermaid = ({ source }: { source: string }) => {
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
