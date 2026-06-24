/**
 * Pure (dependency-free) matching helpers shared by the note search
 * ProseMirror plugin and the find bar. Kept free of Tiptap/DOM imports so the
 * regex/option logic can be unit-tested in isolation.
 */

/** User-facing matching options exposed by the find bar. */
export interface NoteSearchOptions {
  caseSensitive: boolean;
  wholeWord: boolean;
  /** Treat the query as a raw regular expression rather than literal text. */
  regex: boolean;
}

export const DEFAULT_SEARCH_OPTIONS: NoteSearchOptions = {
  caseSensitive: false,
  wholeWord: false,
  regex: false,
};

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Compile the query + options into a global RegExp, or return `null` when the
 * query is empty or (in regex mode) syntactically invalid. The `g` flag is
 * always set so callers can iterate every match.
 */
export const buildSearchRegex = (
  query: string,
  options: NoteSearchOptions = DEFAULT_SEARCH_OPTIONS,
): RegExp | null => {
  if (!query) return null;
  const core = options.regex ? query : escapeRegex(query);
  const pattern = options.wholeWord ? `\\b(?:${core})\\b` : core;
  const flags = options.caseSensitive ? 'g' : 'gi';
  try {
    return new RegExp(pattern, flags);
  } catch {
    return null;
  }
};

/**
 * Collect every match offset within a single string. Guards against zero-width
 * matches (e.g. `a*`, `(?=x)`) by advancing `lastIndex` so the loop always
 * terminates; zero-length hits are dropped.
 */
export const collectMatches = (
  text: string,
  re: RegExp,
): Array<{ index: number; length: number }> => {
  const out: Array<{ index: number; length: number }> = [];
  re.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m[0].length > 0) out.push({ index: m.index, length: m[0].length });
    if (m.index === re.lastIndex) re.lastIndex += 1;
  }
  return out;
};

/** Find every match offset within a single string for the given query/options. */
export const findTextMatches = (
  text: string,
  query: string,
  options: NoteSearchOptions = DEFAULT_SEARCH_OPTIONS,
): Array<{ index: number; length: number }> => {
  const re = buildSearchRegex(query, options);
  if (!re) return [];
  return collectMatches(text, re);
};
