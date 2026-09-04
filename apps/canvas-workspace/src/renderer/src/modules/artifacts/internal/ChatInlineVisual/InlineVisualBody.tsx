import type { RefObject } from 'react';
import type { MermaidRenderResult } from '../../../../utils/mermaid';
import { STREAMING_SHELL, withAutoHeight } from '../streamingShell';
import type { InlineVisualPayload } from './types';

interface Props {
  height: number;
  iframeRef: RefObject<HTMLIFrameElement>;
  isFinal: boolean;
  isStreamingHtml: boolean;
  payload: InlineVisualPayload;
  mermaidResult: MermaidRenderResult | null;
}

export const InlineVisualBody = ({
  height,
  iframeRef,
  isFinal,
  isStreamingHtml,
  payload,
  mermaidResult,
}: Props) => {
  if (payload.type === 'html') {
    return (
      <iframe
        ref={iframeRef}
        className="chat-inline-visual__frame"
        srcDoc={isStreamingHtml ? STREAMING_SHELL : withAutoHeight(payload.content)}
        sandbox="allow-scripts"
        style={{ height }}
        title={payload.title || (isStreamingHtml ? 'Inline visual (streaming)' : 'Inline visual')}
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
  if (payload.type === 'mermaid') {
    if (!isFinal) {
      return (
        <div className="chat-inline-visual__mermaid chat-inline-visual__mermaid--loading">
          <span className="chat-inline-visual__loading-label">Preparing diagram</span>
        </div>
      );
    }
    if (!mermaidResult) {
      return (
        <div className="chat-inline-visual__mermaid chat-inline-visual__mermaid--loading">
          <span className="chat-inline-visual__loading-label">Rendering diagram</span>
        </div>
      );
    }
    if (!mermaidResult.ok) {
      return (
        <div className="chat-inline-visual__mermaid chat-inline-visual__mermaid--error">
          <div className="chat-inline-visual__mermaid-error-title">Mermaid render failed</div>
          <pre className="chat-inline-visual__mermaid-error-detail">{mermaidResult.error}</pre>
        </div>
      );
    }
    return (
      <div
        className="chat-inline-visual__mermaid"
        dangerouslySetInnerHTML={{ __html: mermaidResult.svg }}
      />
    );
  }
  return (
    <div className="chat-inline-visual__error">
      Unsupported visual type: {payload.type}
    </div>
  );
};
