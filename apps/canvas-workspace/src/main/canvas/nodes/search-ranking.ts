/**
 * Relevance scoring for Canvas node search.
 *
 * A query is split into terms: words for space-separated text, and character
 * pairs for CJK runs (Chinese is written without spaces, so "定价策略" must
 * still match "定价和策略"). A node matches when it contains at least one
 * term. Ranking: more matched terms first, then the score, which weights the
 * title above the body and rewards the exact phrase.
 */
export interface SearchFields {
  title: string;
  body: string;
}

export interface SearchScore {
  matchedTerms: number;
  score: number;
  /** Index in `body` of the first matched term, for the snippet. */
  bodyMatchIndex: number;
}

const CJK_RUN = /[⺀-鿿豈-﫿]+/g;
const TERM_SPLIT = /[\s,.;:!?，。；：！？、"'“”‘’()（）[\]【】{}<>《》|/\\]+/;

export function queryTerms(query: string): string[] {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return [];
  const terms = new Set<string>();
  for (const word of normalized.split(TERM_SPLIT)) {
    if (!word) continue;
    const latin = word.replace(CJK_RUN, ' ').trim();
    for (const part of latin.split(/\s+/)) if (part) terms.add(part);
    for (const run of word.match(CJK_RUN) ?? []) {
      if (run.length <= 2) {
        terms.add(run);
        continue;
      }
      for (let index = 0; index < run.length - 1; index += 1) terms.add(run.slice(index, index + 2));
    }
  }
  return [...terms];
}

export function scoreNode(fields: SearchFields, query: string, terms: string[]): SearchScore | null {
  const title = fields.title.toLowerCase();
  const body = fields.body.toLowerCase();
  const phrase = query.trim().toLowerCase();
  let matchedTerms = 0;
  let score = 0;
  let bodyMatchIndex = -1;

  for (const term of terms) {
    const inTitle = title.includes(term);
    const bodyIndex = body.indexOf(term);
    if (!inTitle && bodyIndex < 0) continue;
    matchedTerms += 1;
    score += inTitle ? 3 : 1;
    if (bodyIndex >= 0 && (bodyMatchIndex < 0 || bodyIndex < bodyMatchIndex)) bodyMatchIndex = bodyIndex;
  }
  if (matchedTerms === 0) return null;
  if (phrase && title.includes(phrase)) score += 10;
  else if (phrase && body.includes(phrase)) score += 4;
  return { matchedTerms, score, bodyMatchIndex };
}

/** A one-line excerpt around the first match, or the start of the text. */
export function snippetAround(text: string, matchIndex: number, maxLength = 160): string {
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (normalized.length <= maxLength) return normalized;
  // Whitespace collapsing shifts offsets a little; the window absorbs it.
  const start = matchIndex > maxLength / 3 ? Math.min(matchIndex - Math.floor(maxLength / 3), normalized.length - maxLength) : 0;
  const slice = normalized.slice(Math.max(0, start), Math.max(0, start) + maxLength - 3);
  return `${start > 0 ? '...' : ''}${slice}...`;
}
