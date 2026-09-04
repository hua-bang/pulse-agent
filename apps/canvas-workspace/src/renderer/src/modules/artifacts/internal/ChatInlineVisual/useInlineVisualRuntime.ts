import { useEffect, useMemo, useRef, useState } from 'react';
import { renderMermaidSource, type MermaidRenderResult } from '../../../../utils/mermaid';
import { extractPartialStringField } from '../partialJson';
import type { ChatInlineVisualProps, InlineVisualPayload } from './types';

const MIN_HEIGHT = 120;
const MAX_HEIGHT = 640;

const parsePartial = (partialInput: string | undefined): InlineVisualPayload | null => {
  if (!partialInput) return null;
  const rawType = extractPartialStringField(partialInput, 'type');
  const type = rawType === 'svg' || rawType === 'mermaid' ? rawType : 'html';
  return {
    type,
    title: extractPartialStringField(partialInput, 'title'),
    content: extractPartialStringField(partialInput, 'content') ?? '',
  };
};

type Input = Pick<
  ChatInlineVisualProps,
  'payload' | 'partialInput' | 'streamedContent' | 'streaming'
>;

export const useInlineVisualRuntime = ({
  payload,
  partialInput,
  streamedContent,
  streaming = false,
}: Input) => {
  const [height, setHeight] = useState(MIN_HEIGHT);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const shellReadyRef = useRef(false);
  const pendingMorphRef = useRef<string | null>(null);
  const rafIdRef = useRef(0);
  const partialPayload = useMemo(() => parsePartial(partialInput), [partialInput]);
  const livePayload = useMemo<InlineVisualPayload | null>(() => {
    if (streamedContent != null && streaming) {
      return {
        type: payload?.type ?? partialPayload?.type ?? 'html',
        title: payload?.title ?? partialPayload?.title,
        content: streamedContent,
      };
    }
    return payload ?? partialPayload;
  }, [partialPayload, payload, streamedContent, streaming]);
  const isStreamingHtml = Boolean(
    streaming
    && livePayload?.type === 'html'
    && (!payload || streamedContent != null),
  );

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (event.source !== iframeRef.current?.contentWindow) return;
      const data = event.data;
      if (!data || typeof data !== 'object') return;
      if (data.type === 'morph-ready') {
        shellReadyRef.current = true;
        if (pendingMorphRef.current != null) {
          iframeRef.current?.contentWindow?.postMessage({
            type: 'morph',
            html: pendingMorphRef.current,
          }, '*');
          pendingMorphRef.current = null;
        }
      } else if (data.type === 'height' && typeof data.value === 'number') {
        const clamped = Math.max(MIN_HEIGHT, Math.min(MAX_HEIGHT, data.value));
        setHeight((current) => Math.abs(current - clamped) < 2 ? current : clamped);
      }
    };
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, []);

  useEffect(() => {
    shellReadyRef.current = false;
    pendingMorphRef.current = null;
  }, [isStreamingHtml, Boolean(payload)]);

  useEffect(() => {
    if (!isStreamingHtml || !livePayload?.content) return;
    const html = livePayload.content;
    cancelAnimationFrame(rafIdRef.current);
    rafIdRef.current = requestAnimationFrame(() => {
      if (!shellReadyRef.current) {
        pendingMorphRef.current = html;
        return;
      }
      iframeRef.current?.contentWindow?.postMessage({ type: 'morph', html }, '*');
    });
    return () => cancelAnimationFrame(rafIdRef.current);
  }, [isStreamingHtml, livePayload]);

  const mermaidSource = payload?.type === 'mermaid' ? payload.content : null;
  const [mermaidResult, setMermaidResult] = useState<MermaidRenderResult | null>(null);
  useEffect(() => {
    if (!mermaidSource) {
      setMermaidResult(null);
      return;
    }
    let cancelled = false;
    setMermaidResult(null);
    void renderMermaidSource(mermaidSource).then((result) => {
      if (!cancelled) setMermaidResult(result);
    });
    return () => {
      cancelled = true;
    };
  }, [mermaidSource]);

  return {
    height,
    iframeRef,
    isFinal: Boolean(payload),
    isStreamingHtml,
    livePayload,
    mermaidResult,
  };
};
