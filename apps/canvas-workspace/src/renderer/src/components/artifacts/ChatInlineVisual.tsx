/**
 * Inline visual rendered directly inside an assistant message body.
 *
 * Behavior matches Claude's actual inline-visualization UX (verified against
 * the product, not just the marketing post):
 *
 *  - **Streaming** (LLM still emitting the tool args): show only a quiet
 *    loading skeleton with a tiny pulsing cursor. No partial render. Small
 *    inline visuals look janky when their DOM thrashes mid-stream — Claude
 *    simply reveals the finished thing instead.
 *  - **Done** (tool execution finished): fade the iframe in with a clean
 *    srcdoc so any <script> tags actually run. The iframe still uses the
 *    `withAutoHeight` probe so its size tracks its content.
 *
 * The hover toolbar (Save / Copy / Open) is invisible at rest and fades in
 * when the user points at the visual.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { ArtifactType } from '../../types';
import { useArtifactDrawer } from './ArtifactContext';
import { withAutoHeight } from './streamingShell';

export interface InlineVisualPayload {
  type: ArtifactType;
  title?: string;
  content: string;
}

interface ChatInlineVisualProps {
  workspaceId: string;
  /** Final payload — present once the tool finishes executing. */
  payload?: InlineVisualPayload;
  /** True while the tool is still in flight (no payload yet). */
  streaming?: boolean;
}

const MIN_HEIGHT = 120;
const MAX_HEIGHT = 640;

export const ChatInlineVisual = ({
  workspaceId,
  payload,
  streaming = false,
}: ChatInlineVisualProps) => {
  const { openArtifact } = useArtifactDrawer();
  const [savedId, setSavedId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState(false);
  const [height, setHeight] = useState(MIN_HEIGHT);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  // Listen for `{ type: 'height', value }` from the iframe (the
  // `withAutoHeight` probe) and resize to fit, clamped to [MIN, MAX].
  useEffect(() => {
    const handle = (e: MessageEvent) => {
      if (e.source !== iframeRef.current?.contentWindow) return;
      const data = e.data;
      if (!data || typeof data !== 'object') return;
      if (data.type === 'height' && typeof data.value === 'number') {
        const clamped = Math.max(MIN_HEIGHT, Math.min(MAX_HEIGHT, data.value));
        setHeight(prev => (Math.abs(prev - clamped) < 2 ? prev : clamped));
      }
    };
    window.addEventListener('message', handle);
    return () => window.removeEventListener('message', handle);
  }, []);

  const handleSaveAsArtifact = useCallback(async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!payload || savedId || saving) return;
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

  const handleCopy = useCallback(async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!payload?.content) return;
    try {
      await navigator.clipboard.writeText(payload.content);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      /* clipboard write failed silently */
    }
  }, [payload]);

  const handleOpenSaved = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    if (savedId) openArtifact(workspaceId, savedId);
  }, [savedId, workspaceId, openArtifact]);

  // Loading state — quiet, no preview. Mirrors Claude's "generating
  // visualization…" before the chart appears in one shot.
  if (!payload) {
    return (
      <div className="chat-inline-visual chat-inline-visual--loading" aria-busy="true">
        <div className="chat-inline-visual__stream-edge" aria-hidden="true" />
        <div className="chat-inline-visual__loading">
          <span className="chat-inline-visual__cursor" aria-hidden="true" />
          <span className="chat-inline-visual__loading-label">
            {streaming ? 'Generating visualization' : 'Preparing'}
          </span>
        </div>
      </div>
    );
  }

  const renderBody = () => {
    if (payload.type === 'html') {
      return (
        <iframe
          ref={iframeRef}
          className="chat-inline-visual__frame"
          srcDoc={withAutoHeight(payload.content)}
          sandbox="allow-scripts"
          style={{ height }}
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
  };

  return (
    <div className="chat-inline-visual chat-inline-visual--ready">
      {renderBody()}
      <div className="chat-inline-visual__toolbar" aria-hidden={!payload.content}>
        {savedId ? (
          <button
            type="button"
            className="chat-inline-visual__btn"
            onClick={handleOpenSaved}
            title="Open in drawer"
          >
            Open
          </button>
        ) : (
          <>
            <button
              type="button"
              className="chat-inline-visual__btn"
              onClick={handleCopy}
              disabled={!payload.content}
              title="Copy source"
            >
              {copied ? 'Copied' : 'Copy'}
            </button>
            <button
              type="button"
              className="chat-inline-visual__btn chat-inline-visual__btn--primary"
              onClick={(e) => void handleSaveAsArtifact(e)}
              disabled={saving || !payload.content}
              title="Save as artifact"
            >
              {saving ? 'Saving' : 'Save'}
            </button>
          </>
        )}
      </div>
    </div>
  );
};
