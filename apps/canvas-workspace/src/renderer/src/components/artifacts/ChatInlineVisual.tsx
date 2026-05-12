/**
 * Inline visual rendered directly inside an assistant message body.
 *
 * Two render paths:
 *  - **Streaming**: extract `type` / `title` / `content` from the still-
 *    growing partial JSON the LLM is emitting; load STREAMING_SHELL once,
 *    post the latest accumulated HTML on every tick (rAF-throttled to a
 *    single morph per frame), and let morphdom diff the DOM in place.
 *  - **Done**: the tool finished executing → swap to a clean srcdoc wrapped
 *    with `withAutoHeight()` so any <script> runs and the iframe keeps
 *    reporting size changes.
 *
 * Visual register matches Claude's inline visualizations: chromeless,
 * auto-sized to content, hover-only toolbar (Save / Copy / Open), thin
 * indigo edge line + pulsing cursor as the only streaming indicators.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ArtifactType } from '../../types';
import { useArtifactDrawer } from './ArtifactContext';
import { extractPartialStringField } from './partialJson';
import { STREAMING_SHELL, withAutoHeight } from './streamingShell';

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
  /** True while the tool is still in flight. */
  streaming?: boolean;
}

const MIN_HEIGHT = 120;
const MAX_HEIGHT = 640;

/** Parse whatever fields are extractable from the LLM's still-growing JSON. */
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
  const [copied, setCopied] = useState(false);
  const [height, setHeight] = useState(MIN_HEIGHT);

  const partialPayload = useMemo(() => parsePartial(partialInput), [partialInput]);
  const livePayload: InlineVisualPayload | null = payload ?? partialPayload;

  const isStreamingHtml = streaming && !payload && livePayload?.type === 'html';
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const shellReady = useRef(false);
  const pendingMorph = useRef<string | null>(null);
  const rafId = useRef(0);

  // Receive `morph-ready` (one-shot, after STREAMING_SHELL's listener
  // installs) and `height` (continuous, from the shell's ResizeObserver
  // AND from withAutoHeight's probe in the final srcdoc).
  useEffect(() => {
    const handle = (e: MessageEvent) => {
      if (e.source !== iframeRef.current?.contentWindow) return;
      const data = e.data;
      if (!data || typeof data !== 'object') return;
      if (data.type === 'morph-ready') {
        shellReady.current = true;
        if (pendingMorph.current != null) {
          iframeRef.current?.contentWindow?.postMessage(
            { type: 'morph', html: pendingMorph.current },
            '*',
          );
          pendingMorph.current = null;
        }
      } else if (data.type === 'height' && typeof data.value === 'number') {
        const clamped = Math.max(MIN_HEIGHT, Math.min(MAX_HEIGHT, data.value));
        setHeight(prev => (Math.abs(prev - clamped) < 2 ? prev : clamped));
      }
    };
    window.addEventListener('message', handle);
    return () => window.removeEventListener('message', handle);
  }, []);

  // Reset shell-ready when switching between streaming-shell iframe and
  // final iframe (different srcDoc → reload → contentWindow re-installs).
  useEffect(() => {
    shellReady.current = false;
    pendingMorph.current = null;
  }, [isStreamingHtml, !!payload]);

  // Push the latest accumulated HTML to the streaming shell. Throttled to
  // one morph per animation frame so a burst of deltas doesn't queue 50
  // morphdom diffs back-to-back (which would jank on weaker machines).
  useEffect(() => {
    if (!isStreamingHtml || !livePayload) return;
    const html = livePayload.content;
    if (!html) return;
    cancelAnimationFrame(rafId.current);
    rafId.current = requestAnimationFrame(() => {
      if (!shellReady.current) {
        pendingMorph.current = html;
        return;
      }
      iframeRef.current?.contentWindow?.postMessage({ type: 'morph', html }, '*');
    });
    return () => cancelAnimationFrame(rafId.current);
  }, [isStreamingHtml, livePayload]);

  const handleSaveAsArtifact = useCallback(async (e: React.MouseEvent) => {
    e.stopPropagation();
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

  const handleCopy = useCallback(async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!livePayload?.content) return;
    try {
      await navigator.clipboard.writeText(livePayload.content);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      /* clipboard write failed silently */
    }
  }, [livePayload]);

  const handleOpenSaved = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    if (savedId) openArtifact(workspaceId, savedId);
  }, [savedId, workspaceId, openArtifact]);

  // ── Render branches ──────────────────────────────────────────────────

  // No content yet (LLM hasn't emitted enough JSON to extract anything) —
  // show a quiet loading row with the indigo cursor.
  if (!livePayload || (!livePayload.content && !payload)) {
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

  const isFinal = !!payload;
  const wrapperClass = `chat-inline-visual${isFinal
    ? ' chat-inline-visual--ready'
    : ' chat-inline-visual--streaming'}`;

  const renderBody = () => {
    if (livePayload.type === 'html') {
      if (isStreamingHtml) {
        return (
          <iframe
            ref={iframeRef}
            className="chat-inline-visual__frame"
            srcDoc={STREAMING_SHELL}
            sandbox="allow-scripts"
            style={{ height }}
            title={livePayload.title || 'Inline visual (streaming)'}
          />
        );
      }
      return (
        <iframe
          ref={iframeRef}
          className="chat-inline-visual__frame"
          srcDoc={withAutoHeight(livePayload.content)}
          sandbox="allow-scripts"
          style={{ height }}
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

  return (
    <div className={wrapperClass}>
      {!isFinal && <div className="chat-inline-visual__stream-edge" aria-hidden="true" />}
      {renderBody()}
      <div className="chat-inline-visual__toolbar" aria-hidden={!livePayload.content}>
        {!isFinal ? (
          <span className="chat-inline-visual__cursor" aria-hidden="true" />
        ) : savedId ? (
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
              disabled={!livePayload.content}
              title="Copy source"
            >
              {copied ? 'Copied' : 'Copy'}
            </button>
            <button
              type="button"
              className="chat-inline-visual__btn chat-inline-visual__btn--primary"
              onClick={(e) => void handleSaveAsArtifact(e)}
              disabled={saving || !livePayload.content}
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
