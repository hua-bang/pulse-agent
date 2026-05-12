/**
 * Inline visual rendered directly inside an assistant message body.
 *
 * Matches Claude's "in-line interactive visualizations" UX:
 *  - No card chrome / border / header by default — the visual embeds in the
 *    conversation flow like a paragraph would.
 *  - Auto-sizes to content height: the iframe shell reports its
 *    `documentElement.scrollHeight` over postMessage and we resize to fit
 *    (clamped by a max).
 *  - A tiny floating toolbar appears on hover with "Save" (promote into the
 *    artifact store) and "Copy" — invisible otherwise so it doesn't
 *    interrupt reading.
 *  - Streaming indicator is a 1px indigo line at the top edge plus a small
 *    pulsing cursor in the corner; no heavy shimmer or "Generating…" label.
 *
 * Two render paths:
 *   - **Streaming**: extract `type` / `title` / `content` from the still-
 *     growing partial JSON; load STREAMING_SHELL once, post the latest
 *     accumulated HTML on every tick; morphdom diffs the DOM in place.
 *   - **Done**: re-render with `withAutoHeight(content)` so the final
 *     srcdoc executes <script> tags AND keeps reporting size changes.
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
  /** True while `partialInput` is still growing. */
  streaming?: boolean;
}

const MIN_HEIGHT = 120;
const MAX_HEIGHT = 640;

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
  const isFinalHtml = !streaming && payload?.type === 'html';
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const shellReady = useRef(false);
  const pendingMorph = useRef<string | null>(null);

  // Listen for `{ type: 'height', value }` from the iframe and resize to fit.
  // Single global listener — we filter by `event.source` to ignore other
  // iframes on the page.
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

  // Reset shell-ready flag whenever we switch between streaming and final iframes.
  useEffect(() => {
    shellReady.current = false;
    pendingMorph.current = null;
  }, [isStreamingHtml, isFinalHtml]);

  // Push the latest accumulated HTML into the streaming shell on every tick.
  useEffect(() => {
    if (!isStreamingHtml || !livePayload) return;
    const html = livePayload.content;
    if (!html) return;
    if (!shellReady.current) {
      pendingMorph.current = html;
      return;
    }
    iframeRef.current?.contentWindow?.postMessage({ type: 'morph', html }, '*');
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

  const renderBody = () => {
    if (!livePayload) {
      return (
        <div className="chat-inline-visual__skeleton" aria-hidden="true">
          <div className="chat-inline-visual__skeleton-bar" />
        </div>
      );
    }

    if (livePayload.type === 'html') {
      if (isStreamingHtml) {
        return (
          <iframe
            ref={iframeRef}
            className="chat-inline-visual__frame"
            srcDoc={STREAMING_SHELL}
            sandbox="allow-scripts"
            style={{ height }}
            title={livePayload.title || 'Inline visual'}
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

  const isStreaming = streaming && !payload;
  const hasContent = !!livePayload?.content;

  return (
    <div
      className={`chat-inline-visual${isStreaming ? ' chat-inline-visual--streaming' : ''}`}
    >
      {isStreaming && <div className="chat-inline-visual__stream-edge" aria-hidden="true" />}
      {renderBody()}
      {/* Hover toolbar — invisible until pointer enters the visual. */}
      <div className="chat-inline-visual__toolbar" aria-hidden={!hasContent}>
        {isStreaming ? (
          <span className="chat-inline-visual__cursor" />
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
              disabled={!hasContent}
              title="Copy source"
            >
              {copied ? 'Copied' : 'Copy'}
            </button>
            <button
              type="button"
              className="chat-inline-visual__btn chat-inline-visual__btn--primary"
              onClick={(e) => void handleSaveAsArtifact(e)}
              disabled={saving || !hasContent}
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
