import { useEffect, useState } from 'react';
import './index.css';
import type { AgentTeamArtifactRecord, FileApi } from '../../../../types';
import { agentArtifactLabel } from '../AgentDetail';

interface ArtifactViewerProps {
  artifact: AgentTeamArtifactRecord;
  taskTitle?: string;
  agentName?: string;
  readFile?: FileApi['read'];
  onClose: () => void;
}

interface ArtifactPreview {
  content?: string;
  error?: string;
  loading: boolean;
}

const artifactFilePath = (artifact: AgentTeamArtifactRecord): string | undefined => {
  const uri = artifact.uri?.trim();
  if (!uri) return undefined;
  if (uri.startsWith('file://')) {
    try {
      return decodeURIComponent(new URL(uri).pathname);
    } catch {
      return uri.slice('file://'.length);
    }
  }
  return uri.startsWith('/') ? uri : undefined;
};

export const ArtifactViewer = ({ artifact, taskTitle, agentName, readFile, onClose }: ArtifactViewerProps) => {
  const [preview, setPreview] = useState<ArtifactPreview | null>(null);

  useEffect(() => {
    const path = artifactFilePath(artifact);
    if (!path || !readFile) {
      setPreview({ loading: false });
      return undefined;
    }

    let cancelled = false;
    setPreview({ loading: true });
    void readFile(path).then((result) => {
      if (cancelled) return;
      setPreview({
        content: result.ok ? result.content : undefined,
        error: result.ok ? undefined : result.error ?? 'Unable to read artifact file.',
        loading: false,
      });
    });
    return () => { cancelled = true; };
  }, [artifact, readFile]);

  return (
    <div className="agent-team-artifact-viewer" role="dialog" aria-label="Artifact viewer">
      <div className="agent-team-artifact-viewer__panel">
        <div className="agent-team-artifact-viewer__header">
          <div><span className="agent-team-detail__section-title">{artifact.kind}</span><strong>{agentArtifactLabel(artifact)}</strong></div>
          <button type="button" className="agent-team-artifact-viewer__close" onClick={onClose}>Close</button>
        </div>
        <div className="agent-team-artifact-viewer__meta">
          {taskTitle && <span>Task: {taskTitle}</span>}
          {agentName && <span>Agent: {agentName}</span>}
          <span>{new Date(artifact.createdAt).toLocaleString()}</span>
        </div>
        {artifact.summary && <div className="agent-team-artifact-viewer__section"><span className="agent-team-detail__section-title">Summary</span><p>{artifact.summary}</p></div>}
        {artifact.uri && <div className="agent-team-artifact-viewer__section"><span className="agent-team-detail__section-title">URI</span><code>{artifact.uri}</code></div>}
        {preview?.loading && <div className="agent-team-artifact-viewer__empty">Loading artifact file...</div>}
        {preview?.error && <div className="agent-team-artifact-viewer__error">{preview.error}</div>}
        {preview?.content && <pre className="agent-team-artifact-viewer__content">{preview.content}</pre>}
        {!artifact.summary && !artifact.uri && !preview?.content && <div className="agent-team-artifact-viewer__empty">No preview content was published for this artifact.</div>}
      </div>
    </div>
  );
};
