import './index.css';
import { InlineVisualBody } from './InlineVisualBody';
import type { ChatInlineVisualProps } from './types';
import { useInlineVisualActions } from './useInlineVisualActions';
import { useInlineVisualRuntime } from './useInlineVisualRuntime';

export type { InlineVisualPayload } from './types';

export const ChatInlineVisual = ({
  workspaceId,
  payload,
  partialInput,
  streamedContent,
  streaming = false,
}: ChatInlineVisualProps) => {
  const runtime = useInlineVisualRuntime({
    payload,
    partialInput,
    streamedContent,
    streaming,
  });
  const actions = useInlineVisualActions({
    workspaceId,
    livePayload: runtime.livePayload,
  });

  if (!runtime.livePayload || (!runtime.livePayload.content && !payload)) {
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

  return (
    <div className={`chat-inline-visual${runtime.isFinal
      ? ' chat-inline-visual--ready'
      : ' chat-inline-visual--streaming'}`}
    >
      {!runtime.isFinal && (
        <div className="chat-inline-visual__stream-edge" aria-hidden="true" />
      )}
      <InlineVisualBody
        height={runtime.height}
        iframeRef={runtime.iframeRef}
        isFinal={runtime.isFinal}
        isStreamingHtml={runtime.isStreamingHtml}
        payload={runtime.livePayload}
        mermaidResult={runtime.mermaidResult}
      />
      <div
        className="chat-inline-visual__toolbar"
        aria-hidden={!runtime.livePayload.content}
      >
        {!runtime.isFinal ? (
          <span className="chat-inline-visual__cursor" aria-hidden="true" />
        ) : (
          <>
            <button
              type="button"
              className="chat-inline-visual__btn"
              onClick={(event) => {
                event.stopPropagation();
                void actions.open();
              }}
              disabled={actions.opening || !runtime.livePayload.content}
              title="Open in side drawer"
            >
              {actions.opening ? 'Opening…' : 'Open'}
            </button>
            <button
              type="button"
              className="chat-inline-visual__btn"
              onClick={(event) => {
                event.stopPropagation();
                void actions.copy();
              }}
              disabled={!runtime.livePayload.content}
              title="Copy source"
            >
              {actions.copied ? 'Copied' : 'Copy'}
            </button>
            <button
              type="button"
              className="chat-inline-visual__btn chat-inline-visual__btn--primary"
              onClick={(event) => {
                event.stopPropagation();
                void actions.saveToCanvas();
              }}
              disabled={actions.pinning || actions.pinned || !runtime.livePayload.content}
              title="Save to canvas"
            >
              {actions.pinning ? 'Saving…' : actions.pinned ? 'Saved' : 'Save'}
            </button>
          </>
        )}
      </div>
    </div>
  );
};
