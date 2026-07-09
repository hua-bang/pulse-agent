import { useCallback, useState } from 'react';

export interface ClampIndexOptions {
  /** When true, moving past either edge wraps to the opposite end. Defaults
   *  to false — CLAMP (hold at the edge), the behavior every current caller
   *  needs (NodeMentionPicker, CommandPalette, and the note mention/slash
   *  menus via `clampMenuIndex` in `utils/noteInteractionState.ts`, which
   *  now delegates to `clampIndexMove`). Kept as a real parameter rather
   *  than silently normalizing, in case a future wrap-around list needs it. */
  wrap?: boolean;
}

/**
 * Pure index-move step shared by every "pick one of N by ArrowUp/Down" list.
 * `delta` is typically +1/-1; `length` is the current item count (0 clamps
 * to 0). This is the one piece that was duplicated three ways before this
 * module existed — inline in NodeMentionPicker, inline in CommandPalette,
 * and as `clampMenuIndex` in `utils/noteInteractionState.ts` — and all
 * three turned out to share the same clamp (no-wrap) semantics, so no
 * per-site parameterization was needed beyond `wrap`.
 */
export const clampIndexMove = (
  current: number,
  delta: number,
  length: number,
  { wrap = false }: ClampIndexOptions = {},
): number => {
  if (length <= 0) return 0;
  if (wrap) return (((current + delta) % length) + length) % length;
  return Math.max(0, Math.min(current + delta, length - 1));
};

/** First selectable index (Home). */
export const indexNavHome = (): number => 0;

/** Last selectable index (End). */
export const indexNavEnd = (length: number): number => Math.max(0, length - 1);

export interface UseIndexNavOptions extends ClampIndexOptions {
  initialIndex?: number;
}

export interface UseIndexNavResult {
  index: number;
  /** Jump straight to an index — for pointer-driven selection (hover/focus). */
  setIndex: (index: number) => void;
  /** Step by `delta` within `length`, using this hook's `wrap` option. */
  move: (delta: number, length: number) => void;
  home: () => void;
  end: (length: number) => void;
  /** Reset to `next` (default 0) — e.g. when the underlying list re-filters. */
  reset: (next?: number) => void;
}

/**
 * ui/hooks/useIndexNav — thin hook for SELF-CONTAINED list-nav components
 * that own their own `index` state locally (NodeMentionPicker,
 * CommandPalette). Wraps `clampIndexMove` in `useState` + stable callbacks
 * so the component only wires ArrowUp/ArrowDown/Home/End to
 * `move`/`home`/`end`, and pointer hover/focus to `setIndex`.
 *
 * The EXTERNALLY-DRIVEN site — the note mention/slash menus, whose index
 * lives inside `NoteInteractionState` rather than component state — calls
 * `clampIndexMove` directly instead of this hook (see
 * `utils/noteInteractionState.ts`); it has no local `useState` to wrap.
 */
export const useIndexNav = (options: UseIndexNavOptions = {}): UseIndexNavResult => {
  const { wrap = false, initialIndex = 0 } = options;
  const [index, setIndex] = useState(initialIndex);

  const move = useCallback(
    (delta: number, length: number) => {
      setIndex((current) => clampIndexMove(current, delta, length, { wrap }));
    },
    [wrap],
  );
  const home = useCallback(() => setIndex(0), []);
  const end = useCallback((length: number) => setIndex(indexNavEnd(length)), []);
  const reset = useCallback((next = 0) => setIndex(next), []);

  return { index, setIndex, move, home, end, reset };
};
