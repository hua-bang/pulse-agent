import DOMPurify from 'dompurify';
import { Component, useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import './useDeferredEditorInput.css';

export interface DeferredEditorPoint {
  x: number;
  y: number;
  scrollTop: number;
}

export interface DeferredEditorInput {
  html: string;
  text: string;
  point?: DeferredEditorPoint;
  deletions: ('backward' | 'forward')[];
}

type Handoff = (pending: DeferredEditorInput) => void | boolean;

interface Session {
  identity: string;
  active: boolean;
  composing: boolean;
  draining: boolean;
  handoff?: Handoff;
  point?: DeferredEditorPoint;
  deletions: DeferredEditorInput['deletions'];
}

interface Args {
  identity: string;
  label: string;
}

/** Keep the input outside this boundary; key the boundary by node identity. */
export class DeferredEditorBoundary extends Component<{
  children: ReactNode;
  fallback: ReactNode;
}, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

const makeSession = (identity: string): Session => ({
  identity, active: false, composing: false, draining: false, deletions: [],
});

const formattingProperties = new Set([
  'color', 'background-color', 'font-weight', 'font-style', 'text-decoration',
  'text-align', 'white-space',
]);
const passiveForbiddenTags = [
  'img', 'picture', 'source', 'video', 'audio', 'iframe', 'object', 'embed',
  'form', 'input', 'textarea', 'button', 'select', 'option', 'style', 'link', 'meta', 'base',
];

const safePaste = (html: string): DocumentFragment => {
  const fragment = DOMPurify.sanitize(html, {
    USE_PROFILES: { html: true },
    FORBID_TAGS: passiveForbiddenTags,
    FORBID_ATTR: ['src', 'srcset', 'background', 'id', 'class', 'name', 'contenteditable', 'autofocus'],
    ALLOW_DATA_ATTR: false,
    ADD_ATTR: ['data-color'],
    ALLOWED_URI_REGEXP: /^(?:(?:https?|mailto|tel|pulse-canvas):|\/|#)/i,
    ADD_URI_SAFE_ATTR: ['data-color'],
    RETURN_DOM_FRAGMENT: true,
  });
  // Enforce the passive surface's media restriction before inserting any DOM.
  for (const element of fragment.querySelectorAll(passiveForbiddenTags.join(','))) element.remove();
  for (const element of fragment.querySelectorAll<HTMLElement>('[style]')) {
    for (const property of Array.from(element.style)) {
      if (!formattingProperties.has(property)) element.style.removeProperty(property);
    }
  }
  return fragment;
};

const insertPaste = (element: HTMLDivElement, text: string, fragment?: DocumentFragment) => {
  const holder = document.createElement('div');
  if (fragment) holder.append(fragment);
  // Native editing commands retain the browser's editing/undo behavior. The
  // only HTML supplied here has already been sanitized in a detached fragment.
  if (typeof document.execCommand === 'function') {
    const command = fragment ? 'insertHTML' : 'insertText';
    if (document.execCommand(command, false, fragment ? holder.innerHTML : text)) return;
  }
  // Non-editing DOM hosts (including focused unit tests) lack execCommand.
  const selection = window.getSelection();
  const range = selection?.rangeCount ? selection.getRangeAt(0) : document.createRange();
  if (!element.contains(range.commonAncestorContainer)) {
    range.selectNodeContents(element);
    range.collapse(false);
  }
  range.deleteContents();
  const insertion = document.createDocumentFragment();
  if (fragment) insertion.append(...Array.from(holder.childNodes));
  else insertion.append(document.createTextNode(text));
  const last = insertion.lastChild;
  range.insertNode(insertion);
  if (last) range.setStartAfter(last);
  range.collapse(true);
  selection?.removeAllRanges();
  selection?.addRange(range);
};

/** Keep this input outside Suspense; only the real editor owns durable edits. */
export const useDeferredEditorInput = ({ identity, label }: Args) => {
  const elementRef = useRef<HTMLDivElement>(null);
  const sessionRef = useRef(makeSession(identity));
  const [activeIdentity, setActiveIdentity] = useState<string | null>(null);
  if (sessionRef.current.identity !== identity) sessionRef.current = makeSession(identity);

  const drain = useCallback(() => {
    const session = sessionRef.current;
    const element = elementRef.current;
    if (session.identity !== identity || !element || !session.active
      || session.composing || session.draining || !session.handoff) return;
    session.draining = true;
    try {
      const accepted = session.handoff({
        html: element.innerHTML,
        text: element.innerText ?? element.textContent ?? '',
        point: session.point,
        deletions: [...session.deletions],
      });
      if (accepted === false) return;
      session.active = false;
      session.deletions = [];
      element.replaceChildren();
      element.hidden = true;
      setActiveIdentity(null);
    } catch {
      // Failed loading/handoff must leave the user's input visible and copyable.
    } finally {
      session.draining = false;
    }
  }, [identity]);

  const begin = useCallback((point?: DeferredEditorPoint) => {
    const session = sessionRef.current;
    const element = elementRef.current;
    if (session.identity !== identity || !element) return;
    if (!session.active) {
      session.active = true;
      session.composing = false;
      session.point = point;
      session.deletions = [];
      element.replaceChildren();
    }
    element.hidden = false;
    setActiveIdentity(identity);
    element.focus({ preventScroll: true });
    drain();
  }, [drain, identity]);

  const ready = useCallback((handoff: Handoff) => {
    const session = sessionRef.current;
    if (session.identity !== identity) return () => undefined;
    session.handoff = handoff;
    drain();
    return () => {
      if (session.handoff === handoff) session.handoff = undefined;
    };
  }, [drain, identity]);

  const cancel = useCallback(() => {
    const session = sessionRef.current;
    if (session.identity !== identity) return;
    session.active = false;
    session.composing = false;
    session.deletions = [];
    elementRef.current?.replaceChildren();
    if (elementRef.current) elementRef.current.hidden = true;
    setActiveIdentity(null);
  }, [identity]);

  useEffect(() => () => {
    const session = sessionRef.current;
    if (session.identity === identity) {
      session.active = false;
      session.handoff = undefined;
    }
  }, [identity]);

  const input: ReactNode = (
    <div
      key={identity}
      ref={elementRef}
      className="deferred-editor-input"
      data-deferred-editor-input=""
      role="textbox"
      aria-label={label}
      aria-multiline="true"
      contentEditable
      suppressContentEditableWarning
      hidden={activeIdentity !== identity}
      tabIndex={-1}
      onMouseDown={(event) => event.stopPropagation()}
      onClick={(event) => {
        event.stopPropagation();
        if ((event.target as HTMLElement).closest('a')) event.preventDefault();
      }}
      onKeyDown={(event) => {
        event.stopPropagation();
        const session = sessionRef.current;
        if (!session.active || session.composing || event.nativeEvent.isComposing) return;
        const element = event.currentTarget;
        const empty = !element.textContent && (element.childNodes.length === 0
          || (element.childNodes.length === 1 && element.firstElementChild?.tagName === 'BR'));
        if (empty
          && !event.metaKey && !event.ctrlKey && !event.altKey
          && (event.key === 'Backspace' || event.key === 'Delete')) {
          event.preventDefault();
          session.deletions.push(event.key === 'Backspace' ? 'backward' : 'forward');
        }
      }}
      onInput={(event) => {
        const session = sessionRef.current;
        if (!session.active) return;
        if ((event.nativeEvent as InputEvent).isComposing) session.composing = true;
        drain();
      }}
      onCompositionStart={() => { sessionRef.current.composing = true; }}
      onCompositionEnd={() => {
        sessionRef.current.composing = false;
        drain();
      }}
      onDrop={(event) => {
        event.preventDefault();
        event.stopPropagation();
      }}
      onPaste={(event) => {
        event.preventDefault();
        event.stopPropagation();
        if (!sessionRef.current.active) return;
        const html = event.clipboardData.getData('text/html');
        const text = event.clipboardData.getData('text/plain');
        const fragment = html ? safePaste(html) : undefined;
        if (fragment ? !fragment.hasChildNodes() : !text) return;
        insertPaste(event.currentTarget, text, fragment);
        drain();
      }}
    />
  );

  return { input, begin, ready, cancel };
};
