/**
 * Inline visual rendered directly inside an assistant message body.
 *
 * Source: `visual_render` tool result. The content is temporary — it
 * lives with the chat message and is NOT in the artifact store unless
 * the user clicks "Save as artifact" (which promotes it).
 */

import { useCallback, useMemo, useState } from 'react';
import type { ArtifactType } from '../../types';
import { useArtifactDrawer } from './ArtifactContext';

export interface InlineVisualPayload {
  type: ArtifactType;
  title?: string;
  content: string;
}

interface ChatInlineVisualProps {
  workspaceId: string;
  payload: InlineVisualPayload;
}

const DEFAULT_HEIGHT = 320;

export const ChatInlineVisual = ({ workspaceId, payload }: ChatInlineVisualProps) => {
  const { openArtifact } = useArtifactDrawer();
  const [savedId, setSavedId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const handleSaveAsArtifact = useCallback(async () => {
    if (savedId || saving) return;
    setSaving(true);
    try {
      const result = await window.canvasWorkspace.artifacts.create(workspaceId, {
        type: payload.type,
        title: payload.title || 'Saved visual',
        content: payload.content,
        source: { origin: 'inline_promotion' },
      });
      if (result.ok && result.artifact) {
        setSavedId(result.artifact.id);
        openArtifact(workspaceId, result.artifact.id);
      }
    } finally {
      setSaving(false);
    }
  }, [savedId, saving, workspaceId, payload, openArtifact]);

  const handleOpenSaved = useCallback(() => {
    if (savedId) openArtifact(workspaceId, savedId);
  }, [savedId, workspaceId, openArtifact]);

  const body = useMemo(() => {
    if (payload.type === 'html') {
      return (
        <iframe
          className="chat-inline-visual__frame"
          srcDoc={payload.content}
          sandbox="allow-scripts"
          style={{ height: DEFAULT_HEIGHT }}
          title={payload.title || 'Inline visual'}
        />
      );
    }
    if (payload.type === 'svg') {
      return (
        <div
          className="chat-inline-visual__svg"
          dangerouslySetInnerHTML={{ __html: payload.content }}
        />
      );
    }
    return (
      <div className="chat-inline-visual__error">
        Unsupported visual type: {payload.type}
      </div>
    );
  }, [payload]);

  return (
    <div className="chat-inline-visual">
      <div className="chat-inline-visual__header">
        <div className="chat-inline-visual__label">
          Inline visual
          {payload.title && <span className="chat-inline-visual__title"> · {payload.title}</span>}
        </div>
        {savedId ? (
          <button
            type="button"
            className="chat-inline-visual__action"
            onClick={handleOpenSaved}
          >
            Open in drawer
          </button>
        ) : (
          <button
            type="button"
            className="chat-inline-visual__action chat-inline-visual__action--primary"
            onClick={() => void handleSaveAsArtifact()}
            disabled={saving}
          >
            {saving ? 'Saving…' : 'Save as artifact'}
          </button>
        )}
      </div>
      {body}
    </div>
  );
};
