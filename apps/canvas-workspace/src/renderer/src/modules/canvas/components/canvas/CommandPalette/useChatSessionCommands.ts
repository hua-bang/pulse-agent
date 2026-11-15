import { useEffect, useMemo, useState } from 'react';
import type { SessionSearchHit } from '../../../../../../../shared/agent-chat';
import { requestOpenChatSession } from '../../../../../shared/appCommands';
import type { PaletteCommand } from './model';

const TITLE_DELAY_MS = 150;
/**
 * Content search reads every stored session, so it waits for a longer
 * pause than the cheap title search.
 */
const CONTENT_DELAY_MS = 400;
const SEARCH_LIMIT = 6;
const NO_COMMANDS: PaletteCommand[] = [];

type SearchMode = 'title' | 'content';

interface Found {
  query: string;
  title: SessionSearchHit[];
  content: SessionSearchHit[];
}

const hitKey = (hit: SessionSearchHit): string => `${hit.workspaceId}:${hit.sessionId}`;

const toCommand = (hit: SessionSearchHit): PaletteCommand => ({
  id: `chat:${hitKey(hit)}`,
  title: hit.preview || hit.date,
  hint: [hit.workspaceName, hit.date].filter(Boolean).join(' · '),
  group: 'navigate',
  run: () => requestOpenChatSession({
    sessionId: hit.sessionId,
    storeId: hit.workspaceId,
    label: hit.workspaceName,
  }),
});

/** Title hits first, then content-only hits, one entry per chat. */
const mergeHits = (found: Found): PaletteCommand[] => {
  const seen = new Set<string>();
  const commands: PaletteCommand[] = [];
  for (const hit of [...found.title, ...found.content]) {
    const key = hitKey(hit);
    if (seen.has(key)) continue;
    seen.add(key);
    commands.push(toCommand(hit));
    if (commands.length >= SEARCH_LIMIT) break;
  }
  return commands;
};

/**
 * Stored chats that match `query`, as palette commands that open the chat
 * in its owning scope. Title, preview, and workspace-name matches come
 * first; matches in message text follow after a longer pause. A late
 * answer for an old query is dropped.
 */
export const useChatSessionCommands = (query: string): PaletteCommand[] => {
  const [found, setFound] = useState<Found | null>(null);
  const trimmed = query.trim();

  useEffect(() => {
    if (!trimmed) return undefined;
    let cancelled = false;
    const search = (mode: SearchMode) => {
      void window.canvasWorkspace.agent.searchSessions(trimmed, SEARCH_LIMIT, mode)
        .then((result) => {
          if (cancelled || !result.ok) return;
          const hits = result.hits ?? [];
          setFound((previous) => {
            const base = previous && previous.query === trimmed
              ? previous
              : { query: trimmed, title: [], content: [] };
            return { ...base, [mode]: hits };
          });
        })
        .catch(() => {
          // Chat results are an extra; nodes and commands still work.
        });
    };
    const titleTimer = window.setTimeout(() => search('title'), TITLE_DELAY_MS);
    const contentTimer = window.setTimeout(() => search('content'), CONTENT_DELAY_MS);
    return () => {
      cancelled = true;
      window.clearTimeout(titleTimer);
      window.clearTimeout(contentTimer);
    };
  }, [trimmed]);

  return useMemo(
    () => (found && found.query === trimmed ? mergeHits(found) : NO_COMMANDS),
    [found, trimmed],
  );
};
