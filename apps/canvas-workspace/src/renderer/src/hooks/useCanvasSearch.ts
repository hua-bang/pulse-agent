import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import type { CanvasNode, FileNodeData, TextNodeData } from '../types';
import { setNoteSearch, clearNoteSearch, noteSearchPluginKey } from '../editor/noteSearchExtension';
import { useFileNodeEditorRegistry } from './useFileNodeEditorRegistry';

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

  // Inline highlight inside file nodes — reuse the existing
  // NoteSearchExtension instead of building a parallel decoration
  // system. The set of "nodes that have ≥1 content match" gets the
  // query pushed in; everything else gets cleared so closed/unrelated
  // editors don't keep stale highlights.
  const registry = useFileNodeEditorRegistry();
  // Track which editors we currently have highlights on so we can
  // surgically clear only those that drop out of the set, instead of
  // touching every registered editor on every keystroke (the latter
  // would spam dispatches into nodes that never had a match).
  const highlightedRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!registry) return;
    const q = open ? deferredQuery : '';
    const shouldHighlight = new Set<string>();
    if (q.trim()) {
      for (const m of matches) {
        if (m.field === 'content') shouldHighlight.add(m.nodeId);
      }
    }

    // Apply to newly-included editors.
    for (const id of shouldHighlight) {
      const editor = registry.get(id);
      if (!editor) continue;
      const view = editor.view;
      if (!view) continue;
      const current = noteSearchPluginKey.getState(view.state);
      // Skip dispatch if the editor already shows this exact query —
      // avoids resetting the user's per-note find state when canvas
      // find converges on the same string.
      if (current?.query === q) continue;
      setNoteSearch(view, q);
    }

    // Clear editors that previously had our highlight but no longer do.
    for (const id of highlightedRef.current) {
      if (shouldHighlight.has(id)) continue;
      const editor = registry.get(id);
      if (!editor?.view) continue;
      const current = noteSearchPluginKey.getState(editor.view.state);
      // Only clear if the highlight still matches our pushed query —
      // protects an active per-note find session if the user opened
      // one after we set ours.
      if (current && current.query === deferredQuery) {
        clearNoteSearch(editor.view);
      }
    }

    highlightedRef.current = shouldHighlight;
  }, [open, deferredQuery, matches, registry]);

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
    // Belt-and-suspenders: the effect above also reacts to `open`
    // flipping to false, but call clear directly so the visual state
    // updates in the same frame as the bar dismissing.
    if (registry) {
      for (const id of highlightedRef.current) {
        const editor = registry.get(id);
        if (!editor?.view) continue;
        clearNoteSearch(editor.view);
      }
      highlightedRef.current = new Set();
    }
    const prev = previousFocusRef.current;
    previousFocusRef.current = null;
    // Defer focus restoration to next tick so the SearchBar unmount
    // (which itself touches focus on cleanup) doesn't immediately
    // re-steal it.
    if (prev && typeof prev.focus === 'function') {
      requestAnimationFrame(() => prev.focus());
    }
  }, [registry]);

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
