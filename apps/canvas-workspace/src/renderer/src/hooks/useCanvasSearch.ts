import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import type { CanvasNode, FileNodeData, TextNodeData } from '../types';

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

  // Capture the focused element when the bar opens so Esc can hand
  // focus back to wherever the user came from (avoids breaking the
  // mental model: "I was typing in a file node, hit Ctrl+F, looked
  // around, hit Esc — cursor should be back in my node").
  const previousFocusRef = useRef<HTMLElement | null>(null);

  const openBar = useCallback(() => {
    previousFocusRef.current = document.activeElement as HTMLElement | null;
    setOpen(true);
  }, []);

  const closeBar = useCallback(() => {
    setOpen(false);
    setQuery('');
    setActiveIndex(0);
    const prev = previousFocusRef.current;
    previousFocusRef.current = null;
    // Defer focus restoration to next tick so the SearchBar unmount
    // (which itself touches focus on cleanup) doesn't immediately
    // re-steal it.
    if (prev && typeof prev.focus === 'function') {
      requestAnimationFrame(() => prev.focus());
    }
  }, []);

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
