import { useLayoutEffect, useRef } from 'react';
import { count } from '../../../../../perf/counters';
import { closedFenceCode, highlightLines, openFenceAt } from './openFence';
import { settledMarkdownEnd } from './settledEnd';

interface Props {
  text: string;
  /** Renders one Markdown fragment to HTML. */
  render: (markdown: string) => string;
}

/** An open code block in the tail that grows line by line. */
interface FenceView {
  /** Tail offset and opening line; a change means a different block. */
  key: string;
  opener: string;
  marker: string;
  lang: string;
  code: HTMLElement;
  /** Unfinished last line, shown as plain text. */
  partial: Text;
  /** Code characters already appended as finished lines. */
  appended: number;
}

interface Rendered {
  /** Source of the finished blocks already in the DOM. */
  settled: string;
  render: Props['render'] | null;
  /** DOM nodes of the unfinished tail. */
  tail: ChildNode[];
  fence: FenceView | null;
}

const EMPTY: Rendered = { settled: '', render: null, tail: [], fence: null };

const toNodes = (html: string): ChildNode[] => {
  const template = document.createElement('template');
  template.innerHTML = html;
  return Array.from(template.content.childNodes);
};

/** Highlights and appends finished code after what the view already shows. */
const appendLines = (view: FenceView, code: string, finished: number) => {
  if (finished <= view.appended) return;
  count('chat-md-stream-code-append');
  const lines = toNodes(highlightLines(code.slice(view.appended, finished), view.lang));
  for (const node of lines) view.code.insertBefore(node, view.partial);
  view.appended = finished;
};

const findCode = (nodes: ChildNode[]): HTMLElement | null => {
  for (const node of nodes) {
    if (!(node instanceof HTMLElement)) continue;
    const code = node.matches('code') ? node : node.querySelector('code');
    if (code) return code;
  }
  return null;
};

/**
 * Markdown body for a reply that is still streaming. A block that has
 * finished is rendered once and appended. Each update then renders only the
 * unfinished tail; when the tail is an open code block, only its new finished
 * lines are highlighted and appended. The whole-message render happens once,
 * when the stream ends. The body keeps one flat list of block elements, so
 * the chat styles and the streaming cursor apply as they do to a
 * whole-message render.
 */
export const StreamingMarkdown = ({ text, render }: Props) => {
  const bodyRef = useRef<HTMLDivElement>(null);
  const rendered = useRef<Rendered>(EMPTY);

  useLayoutEffect(() => {
    const body = bodyRef.current;
    if (!body) return;
    let state = rendered.current;
    // Start over when the text no longer extends what is in the DOM (an
    // edited message) or the renderer changed (for example, mention targets).
    if (state.render !== render || !text.startsWith(state.settled)) {
      body.replaceChildren();
      state = { ...EMPTY, render };
    }
    const from = state.settled.length;
    const settledEnd = settledMarkdownEnd(text, from);
    const tailText = text.slice(settledEnd);
    const fence = openFenceAt(tailText);
    const fenceKey = fence ? `${settledEnd}\n${fence.opener}` : '';
    let view = state.fence?.key === fenceKey ? state.fence : null;
    let tail = state.tail;
    const segment = text.slice(from, settledEnd);
    const closed = state.fence && !view
      ? closedFenceCode(segment, state.fence.opener, state.fence.marker)
      : null;

    if (state.fence && closed !== null) {
      // The open block closed: finish its lines and keep it as a settled block.
      appendLines(state.fence, closed, closed.length);
      state.fence.partial.remove();
      tail = [];
    } else {
      if (!view) {
        for (const node of tail) node.remove();
        tail = [];
      }
      if (segment) {
        count('chat-md-stream-segment');
        body.append(...toNodes(render(segment)));
      }
    }
    if (fence && !view) {
      // Render the block shell (header, copy button) once, then fill its code.
      count('chat-md-stream-render');
      const shell = toNodes(render(`${fence.opener}\n${fence.marker}`));
      const code = findCode(shell);
      if (code) {
        const partial = document.createTextNode('');
        code.replaceChildren(partial);
        view = { key: fenceKey, opener: fence.opener, marker: fence.marker, lang: fence.lang, code, partial, appended: 0 };
        tail = shell;
        body.append(...tail);
      }
    }
    if (fence && view) {
      const code = tailText.slice(fence.codeStart, fence.codeEnd ?? tailText.length);
      const finished = fence.codeEnd === null ? code.lastIndexOf('\n') + 1 : code.length;
      appendLines(view, code, finished);
      view.partial.data = code.slice(finished);
    } else if (tailText) {
      count('chat-md-stream-render');
      tail = toNodes(render(tailText));
      body.append(...tail);
    }
    rendered.current = { settled: text.slice(0, settledEnd), render, tail, fence: view };
  }, [text, render]);

  return <div ref={bodyRef} className="chat-message-content chat-md chat-md--streaming chat-md--image-preview" />;
};
