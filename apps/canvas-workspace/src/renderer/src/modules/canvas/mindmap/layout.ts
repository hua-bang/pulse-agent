import type { MindmapTopic } from '../../../types';

/**
 * Horizontal tree layout for a Heptabase-style mindmap.
 *
 * The root sits vertically centered. Children grow rightward, each at a
 * fixed horizontal step from its parent. Vertical space is allocated
 * bottom-up: each topic reserves a slot equal to `max(slotHeight,
 * sum(children slots))`, so subtrees never overlap regardless of depth.
 * This is a simplified Reingold–Tilford: good enough for Heptabase-like
 * cards (a few dozen topics) and stable as the user edits.
 *
 * The returned `width`/`height` describe the bounding box of every
 * rendered topic; callers pad by `PADDING` on every side.
 *
 * Collapsed topics still render themselves but skip their descendants.
 */

export interface LaidOutTopic {
  id: string;
  /** Parent topic id, or null for the root. Used to hit-test keyboard
   *  navigation (Shift+Tab, ArrowLeft). */
  parentId: string | null;
  /** Depth from root — 0 for the root, 1 for a primary branch, etc. */
  depth: number;
  /** Top-left corner of the topic box in mindmap-local coords. */
  x: number;
  y: number;
  width: number;
  height: number;
  text: string;
  /** Resolved color — branch-colored for non-root topics, neutral for
   *  the root. Drives both the topic pill border and the in-bound
   *  branch line. */
  color: string;
  collapsed: boolean;
  hasChildren: boolean;
}

export interface LaidOutBranch {
  /** Parent → child connection. Bezier path in mindmap-local coords,
   *  ready to drop into an <svg> <path d={...}> */
  id: string;
  parentId: string;
  childId: string;
  path: string;
  color: string;
}

export interface MindmapLayout {
  topics: LaidOutTopic[];
  branches: LaidOutBranch[];
  /** Bounding box of the laid-out content (excluding outer padding). */
  width: number;
  height: number;
}

export interface LayoutOptions {
  /** Gap between a parent and its children on the horizontal axis. */
  hGap?: number;
  /** Minimum gap between sibling topic rows. */
  vGap?: number;
  /** Logical topic box width (used for all topics). */
  topicWidth?: number;
  /** Logical topic box height (used when a topic's rendered height is
   *  unknown). In v1 every topic is a single-line pill. */
  topicHeight?: number;
  /** Text being typed into a topic. Sizes that topic's slot from the
   *  draft so the tree makes room while editing; `text` stays stored. */
  draft?: { id: string; text: string } | null;
}

const DEFAULT_OPTS: Required<Omit<LayoutOptions, 'draft'>> = {
  hGap: 64,
  vGap: 14,
  topicWidth: 180,
  topicHeight: 34,
};

/**
 * Heptabase-ish palette for the first six primary branches. Indexing
 * beyond the end wraps, which is fine for the rare case of >6 branches
 * — the colors just repeat. Tuned to match Heptabase's default theme:
 * warm yellow, cool gray, warm orange, etc.
 */
const BRANCH_COLORS = [
  '#D9A13B', // yellow
  '#9AA0A6', // gray
  '#E07B4A', // orange
  '#3B8FD6', // blue
  '#7A57C4', // purple
  '#2F8F5A', // green
];

const ROOT_COLOR = '#1F2328';

/** Same stack as `--font-sans`, so measured widths match the DOM. */
export const MINDMAP_FONT_FAMILY =
  '"Lexend Variable", "PingFang SC", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';

/**
 * Fallback width estimate for environments without a 2D canvas (tests,
 * SSR). It biases CJK slightly above 1em so a slot is never narrower
 * than the rendered text, which would wrap the last glyph.
 */
const CJK = '\\u3000-\\u9fff\\uff00-\\uffef\\u3040-\\u30ff';
const CJK_RANGE = new RegExp(`[${CJK}]`);
// One CJK glyph, a word with its trailing spaces, or a run of spaces.
const WRAP_TOKEN = new RegExp(`[${CJK}]|[^\\s${CJK}]+\\s*|\\s+`, 'g');
const estimateTextWidth = (text: string, fontSize: number): number =>
  text.length * fontSize * (CJK_RANGE.test(text) ? 1.05 : 0.65);

let measureContext: CanvasRenderingContext2D | null | undefined;
const getMeasureContext = () =>
  (measureContext ??= typeof document === 'undefined' ? null : document.createElement('canvas').getContext('2d'));

/**
 * Measure the rendered width of a topic label. Uses canvas `measureText`
 * with the topic font, so the slot hugs the real text and the branch
 * line starts where the text ends. This stays synchronous, because
 * `layoutMindmap` runs in a `useMemo` on every tree mutation.
 */
const measureTextWidth = (text: string, fontSize: number, fontWeight: number): number => {
  if (!text) return 0;
  const ctx = getMeasureContext();
  const font = `${fontWeight} ${fontSize}px ${MINDMAP_FONT_FAMILY}`;
  // Until the font loads, canvas would measure the fallback face; the
  // estimate errs wide, so text never wraps early.
  if (!ctx || document.fonts?.check(font) === false) return estimateTextWidth(text, fontSize);
  ctx.font = font;
  // `pre-wrap` keeps explicit line breaks; the widest line sets the slot.
  return Math.max(...text.split('\n').map((line) => ctx.measureText(line).width));
};

/**
 * Wrap a topic label into lines like `.mindmap-topic-text` does
 * (`pre-wrap` + `overflow-wrap: break-word`): break between words and
 * between CJK glyphs, and inside a token only when it alone is wider
 * than the line. Layout counts the lines; image export draws them.
 */
export const wrapTopicLines = (text: string, maxWidth: number): string[] => {
  const fits = (value: string) => measureTextWidth(value.trimEnd(), 14, 400) <= maxWidth;
  const lines: string[] = [];
  for (const source of text.split('\n')) {
    let line = '';
    for (const token of source.match(WRAP_TOKEN) ?? []) {
      if (line && !fits(line + token)) {
        lines.push(line.trimEnd());
        line = token.trimStart();
      } else {
        line += token;
      }
      while (line.length > 1 && !fits(line)) {
        let cut = line.length - 1;
        while (cut > 1 && !fits(line.slice(0, cut))) cut--;
        lines.push(line.slice(0, cut));
        line = line.slice(cut);
      }
    }
    lines.push(line || ' ');
  }
  return lines;
};

const ROOT_MIN_WIDTH = 120;
const TOPIC_MIN_WIDTH = 36;
const TOPIC_MAX_WIDTH = 320;
// Horizontal chrome around the text: `.mindmap-topic` has `padding: 0 8px`
// (16px) and the inner `.mindmap-topic-text` adds `padding: 1px 3px` (6px),
// for 22px total. Keep a buffer for sub-pixel rounding and late font swaps.
const TOPIC_HORIZONTAL_PADDING = 26;

export const layoutMindmap = (
  root: MindmapTopic,
  opts: LayoutOptions = {},
): MindmapLayout => {
  const o = { ...DEFAULT_OPTS, ...opts };
  const labelOf = (t: MindmapTopic) =>
    (opts.draft?.id === t.id ? opts.draft.text : t.text) || 'Untitled';
  const topics: LaidOutTopic[] = [];
  const branches: LaidOutBranch[] = [];

  // Per-topic widths. The root gets a larger font + generous minimum so
  // short "Central topic"-style labels don't awkwardly wrap at word
  // boundaries; every other topic scales between TOPIC_MIN_WIDTH and
  // TOPIC_MAX_WIDTH based on its text length.
  const widthOf = new Map<string, number>();
  const resolveWidth = (t: MindmapTopic, isRoot: boolean): number => {
    const cached = widthOf.get(t.id);
    if (cached !== undefined) return cached;
    // The root renders with `nowrap`, which shows line breaks as spaces.
    const text = isRoot ? labelOf(t).replace(/\n/g, ' ') : labelOf(t);
    // Topic actions (+, fold) float outside the slot, so the slot is only
    // the text plus its padding. This keeps the branch line on the text.
    const measured =
      measureTextWidth(text, isRoot ? 20 : 14, isRoot ? 500 : 400) + TOPIC_HORIZONTAL_PADDING;
    const min = isRoot ? ROOT_MIN_WIDTH : TOPIC_MIN_WIDTH;
    const w = Math.max(min, Math.min(TOPIC_MAX_WIDTH, Math.ceil(measured)));
    widthOf.set(t.id, w);
    return w;
  };

  // Per-topic rendered height. When a topic's text exceeds TOPIC_MAX_WIDTH
  // it wraps to multiple lines; the slot allocated for it must grow to
  // match, otherwise sibling subtrees stack on top of the wrapped text
  // (which is what produced the "long topic overlaps the next branch"
  // bug). Root is forced single-line by CSS (`white-space: nowrap`), so
  // we keep the default height there.
  const heightOf = new Map<string, number>();
  const resolveHeight = (t: MindmapTopic, isRoot: boolean): number => {
    const cached = heightOf.get(t.id);
    if (cached !== undefined) return cached;
    if (isRoot) {
      heightOf.set(t.id, o.topicHeight);
      return o.topicHeight;
    }
    const fontSize = 14;
    const lineHeight = Math.ceil(fontSize * 1.3); // matches .mindmap-topic CSS
    const w = resolveWidth(t, false);
    const available = Math.max(lineHeight, w - TOPIC_HORIZONTAL_PADDING);
    const text = labelOf(t);
    // Count wrapped lines per explicit line, so Shift+Enter breaks add height.
    const lines = wrapTopicLines(text, available).length;
    // 4px = .mindmap-topic-text top+bottom padding (1px) + a hair of buffer
    // for line-box rounding. Clamp to the default topic slot so single-line
    // topics keep their existing visual rhythm.
    const h = Math.max(o.topicHeight, lines * lineHeight + 4);
    heightOf.set(t.id, h);
    return h;
  };

  // Pass 1: compute the vertical "slot" each topic needs — the height
  // it will occupy including all visible descendants.
  const slotOf = new Map<string, number>();
  const measure = (t: MindmapTopic, depth: number): number => {
    const isRoot = depth === 0;
    const own = resolveHeight(t, isRoot);
    const kids = t.collapsed ? [] : t.children;
    if (kids.length === 0) {
      slotOf.set(t.id, own);
      return own;
    }
    let total = 0;
    for (let i = 0; i < kids.length; i++) {
      total += measure(kids[i], depth + 1);
      if (i > 0) total += o.vGap;
    }
    // A parent with children still needs at least its own height so the
    // pill doesn't collapse into a sliver when a single child lives below.
    const s = Math.max(total, own);
    slotOf.set(t.id, s);
    return s;
  };
  const totalHeight = measure(root, 0);

  // Pass 2: place each topic. `yCursor` is the top of the current node's
  // slot; we center the node vertically inside its slot, then walk
  // children top-down.
  const walk = (
    t: MindmapTopic,
    depth: number,
    parentId: string | null,
    xLeft: number,
    yCursor: number,
    color: string,
  ) => {
    const isRoot = depth === 0;
    const selfWidth = resolveWidth(t, isRoot);
    const selfHeight = resolveHeight(t, isRoot);
    const slot = slotOf.get(t.id) ?? selfHeight;
    const y = yCursor + (slot - selfHeight) / 2;
    const laidOut: LaidOutTopic = {
      id: t.id,
      parentId,
      depth,
      x: xLeft,
      y,
      width: selfWidth,
      height: selfHeight,
      text: t.text,
      color,
      collapsed: !!t.collapsed,
      hasChildren: t.children.length > 0,
    };
    topics.push(laidOut);

    if (t.collapsed || t.children.length === 0) return;

    // Children sit to the right of this topic, stacked vertically
    // within this topic's slot.
    const childXLeft = xLeft + selfWidth + o.hGap;
    let childYCursor = yCursor;
    for (let i = 0; i < t.children.length; i++) {
      const child = t.children[i];
      const childHeight = resolveHeight(child, false);
      const childSlot = slotOf.get(child.id) ?? childHeight;

      // Primary branches get a color from the palette; deeper topics
      // inherit their branch ancestor's color.
      const childColor =
        depth === 0 ? BRANCH_COLORS[i % BRANCH_COLORS.length] : color;

      walk(child, depth + 1, t.id, childXLeft, childYCursor, childColor);

      // Branches anchor at the vertical CENTER of both parent and
      // child so the curve reads as "line passes through the middle
      // of the text". Anchoring at the baseline puts text visually
      // above its branch, which felt off-axis for this chromeless
      // layout where there's no outline to give the baseline a
      // reason to exist.
      const parentRightX = xLeft + selfWidth;
      const parentAnchorY = y + selfHeight / 2;
      const childLeftX = childXLeft;
      const childAnchorY =
        childYCursor + (childSlot - childHeight) / 2 + childHeight / 2;
      const midX = parentRightX + (childLeftX - parentRightX) / 2;
      const path =
        `M ${parentRightX} ${parentAnchorY} ` +
        `C ${midX} ${parentAnchorY}, ${midX} ${childAnchorY}, ${childLeftX} ${childAnchorY}`;
      branches.push({
        id: `${t.id}->${child.id}`,
        parentId: t.id,
        childId: child.id,
        path,
        color: childColor,
      });

      childYCursor += childSlot + o.vGap;
    }
  };

  walk(root, 0, null, 0, 0, ROOT_COLOR);

  // The walk starts at (0, 0) and every topic sits at or below its
  // slot's top, so the tree already starts at (0, 0): the first-child
  // chain ends in a topic whose slot is its own height. Only the far
  // edges need measuring.
  let maxX = 0;
  let maxY = 0;
  for (const t of topics) {
    maxX = Math.max(maxX, t.x + t.width);
    maxY = Math.max(maxY, t.y + t.height);
  }

  return {
    topics,
    branches,
    width: maxX,
    height: Math.max(maxY, totalHeight),
  };
};
