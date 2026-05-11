/**
 * Inline visual rendered directly inside an assistant message body.
 *
 * Two render paths:
 *   - **Streaming** (LLM is still emitting the tool's input JSON): we extract
 *     `type` / `title` / `content` from the partial JSON as it grows, post
 *     accumulated HTML into a sandboxed iframe shell, and morphdom diffs the
 *     DOM in place. Mirrors the IframeNodeBody AI-tab UX.
 *   - **Done** (tool execution finished, final result available): re-render
 *     with a clean srcdoc so any <script> tags actually run.
 *
 * Source: `visual_render` tool. The content is temporary — it lives with the
 * chat message and is NOT in the artifact store unless the user clicks
 * "Save as artifact" (which promotes it).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ArtifactType } from '../../types';
import { useArtifactDrawer } from './ArtifactContext';
import { extractPartialStringField } from './partialJson';
import { STREAMING_SHELL } from './streamingShell';

export interface InlineVisualPayload {
  type: ArtifactType;
  title?: string;
  content: string;
}

interface ChatInlineVisualProps {
  workspaceId: string;
  /** Final payload — present once the tool finishes executing. */
  payload?: InlineVisualPayload;
  /** Streaming raw JSON of the tool's input, accumulated so far. */
  partialInput?: string;
  /** True while `partialInput` is still growing. */
  streaming?: boolean;
}

const DEFAULT_HEIGHT = 320;

/**
 * Read whatever can be parsed from a partial JSON string the LLM is still
 * emitting. Fields appear in declaration order, so `type` and `title`
 * generally land before `content`.
 */
function parsePartial(partialInput: string | undefined): InlineVisualPayload | null {
  if (!partialInput) return null;
  const rawType = extractPartialStringField(partialInput, 'type');
  const type: ArtifactType =
    rawType === 'svg' || rawType === 'mermaid' ? rawType : 'html';
  const title = extractPartialStringField(partialInput, 'title');
  const content = extractPartialStringField(partialInput, 'content') ?? '';
  return { type, title, content };
}

export const ChatInlineVisual = ({
  workspaceId,
  payload,
  partialInput,
  streaming = false,
}: ChatInlineVisualProps) => {
  const { openArtifact } = useArtifactDrawer();
  const [savedId, setSavedId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Resolve which payload to render: prefer the final one once done; fall back
  // to the partial one while the LLM is still emitting.
  const partialPayload = useMemo(() => parsePartial(partialInput), [partialInput]);
  const livePayload: InlineVisualPayload | null = payload ?? partialPayload;

  const isStreamingHtml = streaming && !payload && livePayload?.type === 'html';
  const streamIframeRef = useRef<HTMLIFrameElement>(null);
  const shellReady = useRef(false);
  const pendingMorph = useRef<string | null>(null);

  // The streaming iframe needs to know when its postMessage listener has
  // installed. Until then we queue the latest accumulated HTML.
  useEffect(() => {
    if (!isStreamingHtml) {
      shellReady.current = false;
      pendingMorph.current = null;
      return;
    }
    const handleReady = (e: MessageEvent) => {
      if (e.source !== streamIframeRef.current?.contentWindow) return;
      if (e.data?.type !== 'morph-ready') return;
      shellReady.current = true;
      if (pendingMorph.current != null) {
        streamIframeRef.current?.contentWindow?.postMessage(
          { type: 'morph', html: pendingMorph.current },
          '*',
        );
        pendingMorph.current = null;
      }
    };
    window.addEventListener('message', handleReady);
    return () => {
      window.removeEventListener('message', handleReady);
    };
  }, [isStreamingHtml]);

  // Push the latest HTML into the streaming shell on every partial update.
  useEffect(() => {
    if (!isStreamingHtml || !livePayload) return;
    const html = livePayload.content;
    if (!html) return;
    if (!shellReady.current) {
      pendingMorph.current = html;
      return;
    }
    streamIframeRef.current?.contentWindow?.postMessage({ type: 'morph', html }, '*');
  }, [isStreamingHtml, livePayload]);

  const handleSaveAsArtifact = useCallback(async () => {
    if (!livePayload || savedId || saving) return;
    setSaving(true);
    try {
      const result = await window.canvasWorkspace.artifacts.create(workspaceId, {
        type: livePayload.type,
        title: livePayload.title || 'Saved visual',
        content: livePayload.content,
        source: { origin: 'inline_promotion' },
      });
      if (result.ok && result.artifact) {
        setSavedId(result.artifact.id);
        openArtifact(workspaceId, result.artifact.id);
      }
    } finally {
      setSaving(false);
    }
  }, [savedId, saving, workspaceId, livePayload, openArtifact]);

  const handleOpenSaved = useCallback(() => {
    if (savedId) openArtifact(workspaceId, savedId);
  }, [savedId, workspaceId, openArtifact]);

  const renderBody = () => {
    if (!livePayload) {
      // No type/content extractable yet — show a thin skeleton bar.
      return (
        <div className="chat-inline-visual__skeleton">
          <div className="chat-inline-visual__skeleton-bar" />
        </div>
      );
    }

    if (livePayload.type === 'html') {
      if (isStreamingHtml) {
        // Streaming mode — load the shell once, push deltas via postMessage.
        return (
          <iframe
            ref={streamIframeRef}
            className="chat-inline-visual__frame"
            srcDoc={STREAMING_SHELL}
            sandbox="allow-scripts"
            style={{ height: DEFAULT_HEIGHT }}
            title={livePayload.title || 'Inline visual (streaming)'}
          />
        );
      }
      // Final mode — clean srcDoc so scripts execute.
      return (
        <iframe
          className="chat-inline-visual__frame"
          srcDoc={livePayload.content}
          sandbox="allow-scripts"
          style={{ height: DEFAULT_HEIGHT }}
          title={livePayload.title || 'Inline visual'}
        />
      );
    }
    if (livePayload.type === 'svg') {
      return (
        <div
          className="chat-inline-visual__svg"
          dangerouslySetInnerHTML={{ __html: livePayload.content }}
        />
      );
    }
    return (
      <div className="chat-inline-visual__error">
        Unsupported visual type: {livePayload.type}
      </div>
    );
  };

  const title = livePayload?.title;
  const showShimmer = isStreamingHtml || (streaming && !livePayload);

  return (
    <div className={`chat-inline-visual${showShimmer ? ' chat-inline-visual--streaming' : ''}`}>
      {showShimmer && <div className="chat-inline-visual__shimmer" />}
      <div className="chat-inline-visual__header">
        <div className="chat-inline-visual__label">
          {streaming ? 'Generating visual' : 'Inline visual'}
          {title && <span className="chat-inline-visual__title"> · {title}</span>}
        </div>
        {streaming && !payload ? (
          <span className="chat-inline-visual__progress">
            <span className="chat-inline-visual__spinner" />
          </span>
        ) : savedId ? (
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
            disabled={saving || !livePayload?.content}
          >
            {saving ? 'Saving…' : 'Save as artifact'}
          </button>
        )}
      </div>
      {renderBody()}
    </div>
  );
};
