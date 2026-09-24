import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import type { CanvasNode, FileNodeData, TextNodeData } from '../../../types';
import { useFileNodeEditorRegistry } from '../../../shared/fileNodeEditorRegistry';

// noteSearchExtension pulls @tiptap/react + @tiptap/pm; a static import here
// would drag prosemirror into the entry chunk via Canvas → useCanvasSearch
// (chain B). Inline highlighting only makes sense once a file-node editor is
// mounted — and mounting one loads the file-node chunk that already contains
// this module — so the dynamic import below resolves from cache in practice.
type NoteSearchModule = typeof import('../../note-editor');
let noteSearchModule: NoteSearchModule | null = null;
let noteSearchLoad: Promise<NoteSearchModule> | null = null;
const loadNoteSearch = (): Promise<NoteSearchModule> =>
  noteSearchLoad ??= import('../../note-editor').then((m) => (noteSearchModule = m));


/**
 * A single hit found by the Ctrl+F search.
 *
 * `field` distinguishes where the match lives so the UI can render
 * different snippets (a path vs a content excerpt vs the title).
 */
export interface SearchMatch {
  nodeId: string;
  field: 'title' | 'filePath' | 'content';
  /** Display snippet for the result row. */
  snippet: string;
}

export interface SearchOptions {
  caseSensitive?: boolean;
}

interface Args {
  nodes: CanvasNode[];
}

const SNIPPET_RADIUS = 24;

/**
 * Find-in-canvas state machine.
 *
 * Why a dedicated hook (instead of folding it into CommandPalette):
 *  - Different mental model: Ctrl+F is *iterative* — the bar stays
 *    open while the user pages through matches.
 *  - Needs `activeIndex` + `next/prev` + `total` semantics that the
 *    palette (which closes after Enter) does not.
 *  - Lets us share the same matches list between SearchBar (rendering
 *    "3/12" + result rows) and the canvas (drawing the highlight ring
 *    on the active node).
 *
 * Performance: with ≤ ~100 nodes and short text content, a full re-scan
 * per keystroke is well under a millisecond. We use `useDeferredValue`
 * on the query just to keep the input frame from blocking on huge
 * file-node content.
 */
export const useCanvasSearch = ({ nodes }: Args) => {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const requestRef = useRef({ open, query });
  requestRef.current = { open, query };

  const deferredQuery = useDeferredValue(query);

  const matches = useMemo<SearchMatch[]>(() => {
    const raw = deferredQuery;
    if (!raw.trim()) return [];
    const q = caseSensitive ? raw : raw.toLowerCase();
    const out: SearchMatch[] = [];

    // Stable, geometry-based ordering: top-to-bottom, then left-to-right.
    // This matches how a user scans a canvas, so next/prev feels
    // predictable instead of following whatever insertion order the
    // store happens to hold.
    const ordered = [...nodes].sort((a, b) => {
      if (a.y !== b.y) return a.y - b.y;
      return a.x - b.x;
    });

    const norm = (s: string) => (caseSensitive ? s : s.toLowerCase());
    const snippetAround = (text: string, idx: number) => {
      const start = Math.max(0, idx - SNIPPET_RADIUS);
      const end = Math.min(text.length, idx + q.length + SNIPPET_RADIUS);
      const prefix = start > 0 ? '…' : '';
      const suffix = end < text.length ? '…' : '';
      return prefix + text.slice(start, end).replace(/\s+/g, ' ') + suffix;
    };

    for (const node of ordered) {
      // 1) Title — every node has one.
      if (norm(node.title).includes(q)) {
        out.push({ nodeId: node.id, field: 'title', snippet: node.title });
      }

      // 2) Type-specific fields.
      if (node.type === 'file') {
        const data = node.data as FileNodeData;
        const fp = data.filePath ?? '';
        if (fp && norm(fp).includes(q)) {
          out.push({ nodeId: node.id, field: 'filePath', snippet: fp });
        }
        const content = data.content ?? '';
        if (content) {
          // Tiptap stores HTML in `content`. Strip tags cheaply for the
          // text search — we don't need ProseMirror-level accuracy at
          // the find-bar level (that lives in the future MR2 inline-
          // highlight extension).
          const text = content.replace(/<[^>]+>/g, ' ');
          const hay = norm(text);
          const idx = hay.indexOf(q);
          if (idx !== -1) {
            out.push({ nodeId: node.id, field: 'content', snippet: snippetAround(text, idx) });
          }
        }
      } else if (node.type === 'text') {
        const content = (node.data as TextNodeData).content ?? '';
        if (content) {
          const hay = norm(content);
          const idx = hay.indexOf(q);
          if (idx !== -1) {
            out.push({ nodeId: node.id, field: 'content', snippet: snippetAround(content, idx) });
          }
        }
      }
    }

    return out;
  }, [deferredQuery, caseSensitive, nodes]);

  // Reset cursor whenever the result set shape changes. We don't reset
  // on every keystroke — only when match count actually drops below
  // the current index (e.g. results shrink as the user types more).
  useEffect(() => {
    if (activeIndex >= matches.length) setActiveIndex(0);
  }, [matches.length, activeIndex]);

  // The matching/navigation state is eager; editor readiness and decorations
  // are needed only for an explicit file-content search.
  const registry = useFileNodeEditorRegistry();
  const highlighter = useRef<ReturnType<NoteSearchModule['createCanvasSearchHighlights']> | null>(null);
  const clearHighlights = useCallback(() => highlighter.current?.clear(), []);
  useEffect(() => () => {
    highlighter.current?.dispose();
    highlighter.current = null;
  }, [registry]);

  useEffect(() => {
    if (!registry) return;
    const q = open && query === deferredQuery ? deferredQuery : '';
    const fileIds = new Set(nodes.filter(node => node.type === 'file').map(node => node.id));
    const ids = new Set(matches.filter(match => match.field === 'content' && fileIds.has(match.nodeId))
      .map(match => match.nodeId));
    if (!q.trim() || !ids.size) {
      clearHighlights();
      return;
    }
    for (const id of ids) registry.requestActivation(id);
    let cancelled = false;
    const isCurrent = () => !cancelled && requestRef.current.open === open && requestRef.current.query === query;
    const apply = (module: NoteSearchModule) => {
      if (!isCurrent()) return;
      highlighter.current ??= module.createCanvasSearchHighlights(registry);
      highlighter.current.update(q, ids, isCurrent);
    };
    if (noteSearchModule) apply(noteSearchModule);
    else void loadNoteSearch().then(apply);
    return () => { cancelled = true; };
  }, [open, query, deferredQuery, matches, nodes, registry, clearHighlights]);

  // Capture the focused element when the bar opens so Esc can hand
  // focus back to wherever the user came from (avoids breaking the
  // mental model: "I was typing in a file node, hit Ctrl+F, looked
  // around, hit Esc — cursor should be back in my node").
  const previousFocusRef = useRef<HTMLElement | null>(null);

  const openBar = useCallback(() => {
    previousFocusRef.current = document.activeElement as HTMLElement | null;
    requestRef.current.open = true;
    setOpen(true);
  }, []);

  const closeBar = useCallback(() => {
    requestRef.current.open = false;
    setOpen(false);
    setQuery('');
    setActiveIndex(0);
    // Belt-and-suspenders: the effect above also reacts to `open`
    // flipping to false, but call clear directly so the visual state
    // updates in the same frame as the bar dismissing. If the module
    // never loaded, no highlight was ever set — nothing to clear.
    clearHighlights();
    const prev = previousFocusRef.current;
    previousFocusRef.current = null;
    // Defer focus restoration to next tick so the SearchBar unmount
    // (which itself touches focus on cleanup) doesn't immediately
    // re-steal it.
    if (prev && typeof prev.focus === 'function') {
      requestAnimationFrame(() => prev.focus());
    }
  }, [clearHighlights]);

  const toggleBar = useCallback(() => {
    if (open) closeBar();
    else openBar();
  }, [open, openBar, closeBar]);

  const next = useCallback(() => {
    if (matches.length === 0) return;
    setActiveIndex((i) => (i + 1) % matches.length);
  }, [matches.length]);

  const prev = useCallback(() => {
    if (matches.length === 0) return;
    setActiveIndex((i) => (i - 1 + matches.length) % matches.length);
  }, [matches.length]);

  const activeMatch = matches[activeIndex] ?? null;

  return {
    open,
    query,
    setQuery,
    caseSensitive,
    setCaseSensitive,
    matches,
    activeIndex,
    setActiveIndex,
    activeMatch,
    openBar,
    closeBar,
    toggleBar,
    next,
    prev,
  };
};

export type UseCanvasSearchReturn = ReturnType<typeof useCanvasSearch>;
