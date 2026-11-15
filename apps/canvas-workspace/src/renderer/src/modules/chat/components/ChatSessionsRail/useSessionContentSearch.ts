import { useEffect, useState } from 'react';

const SEARCH_DELAY_MS = 250;
const SEARCH_LIMIT = 200;
const NO_MATCHES: ReadonlySet<string> = new Set();

/**
 * Ids of sessions whose message text contains `query`. The rail filters by
 * title and date at once; this adds message-text matches after the user
 * pauses typing. A late answer for an old query is dropped.
 */
export const useSessionContentSearch = (query: string): ReadonlySet<string> => {
  const [matches, setMatches] = useState<{ query: string; ids: ReadonlySet<string> } | null>(null);
  const trimmed = query.trim();

  useEffect(() => {
    if (!trimmed) return undefined;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void window.canvasWorkspace.agent.searchSessions(trimmed, SEARCH_LIMIT, 'content')
        .then((result) => {
          if (cancelled || !result.ok) return;
          setMatches({ query: trimmed, ids: new Set((result.hits ?? []).map((hit) => hit.sessionId)) });
        })
        .catch(() => {
          // Content search is an extra; the title filter still works.
        });
    }, SEARCH_DELAY_MS);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [trimmed]);

  return matches && matches.query === trimmed ? matches.ids : NO_MATCHES;
};
