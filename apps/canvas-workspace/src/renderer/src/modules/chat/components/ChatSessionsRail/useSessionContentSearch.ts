import { useEffect, useState } from 'react';

const SEARCH_DELAY_MS = 250;
const SEARCH_LIMIT = 200;
const NO_MATCHES: ReadonlySet<string> = new Set();

export interface SessionContentSearchResult {
  ids: ReadonlySet<string>;
  searching: boolean;
}

/**
 * Ids of sessions whose message text contains `query`. The rail filters by
 * title and date at once; this adds message-text matches after the user
 * pauses typing. A late answer for an old query is dropped.
 */
export const useSessionContentSearch = (query: string): SessionContentSearchResult => {
  const [matches, setMatches] = useState<{ query: string; ids: ReadonlySet<string> } | null>(null);
  const trimmed = query.trim();

  useEffect(() => {
    if (!trimmed) return undefined;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void window.canvasWorkspace.agent.searchSessions(trimmed, SEARCH_LIMIT, 'content')
        .then((result) => {
          if (cancelled) return;
          setMatches({
            query: trimmed,
            ids: result.ok
              ? new Set((result.hits ?? []).map((hit) => hit.sessionId))
              : NO_MATCHES,
          });
        })
        .catch(() => {
          if (cancelled) return;
          // Content search is an extra; the title filter still works.
          setMatches({ query: trimmed, ids: NO_MATCHES });
        });
    }, SEARCH_DELAY_MS);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [trimmed]);

  const settled = matches?.query === trimmed;
  return {
    ids: settled ? matches.ids : NO_MATCHES,
    searching: Boolean(trimmed) && !settled,
  };
};
