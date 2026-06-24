import type { CanvasNode } from '../types';

export interface MentionTrigger {
  query: string;
  /** Offset of the `@` character within the inspected text. */
  atIndex: number;
}

// `@` must start a word (line start or after whitespace / an opening paren) so
// it doesn't fire inside emails or `a@b`. Query stops at the next whitespace.
const MENTION_RE = /(?:^|[\s(])@([^\s@]{0,40})$/;

/** Detect an in-progress `@mention` immediately before the caret. */
export const detectMention = (textBefore: string): MentionTrigger | null => {
  const m = textBefore.match(MENTION_RE);
  if (!m) return null;
  const query = m[1] ?? '';
  return { query, atIndex: textBefore.length - query.length - 1 };
};

export const MENTION_MAX_RESULTS = 20;

/** Filter mention candidates by a case-insensitive title substring match. */
export const filterMentionCandidates = (
  candidates: CanvasNode[],
  query: string,
): CanvasNode[] => {
  if (!query) return candidates.slice(0, MENTION_MAX_RESULTS);
  const q = query.toLowerCase();
  return candidates
    .filter((n) => (n.title || '').toLowerCase().includes(q))
    .slice(0, MENTION_MAX_RESULTS);
};
