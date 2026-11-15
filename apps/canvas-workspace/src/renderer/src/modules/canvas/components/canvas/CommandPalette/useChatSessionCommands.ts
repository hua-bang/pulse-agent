import { useEffect, useState } from 'react';
import { requestOpenChatSession } from '../../../../../shared/appCommands';
import type { PaletteCommand } from './model';

const SEARCH_DELAY_MS = 150;
const SEARCH_LIMIT = 6;
const NO_COMMANDS: PaletteCommand[] = [];

/**
 * Stored chats whose title, preview, or workspace name match `query`, as
 * palette commands that open the chat in its owning scope. The search runs
 * after the user pauses typing. A late answer for an old query is dropped.
 */
export const useChatSessionCommands = (query: string): PaletteCommand[] => {
  const [found, setFound] = useState<{ query: string; commands: PaletteCommand[] } | null>(null);
  const trimmed = query.trim();

  useEffect(() => {
    if (!trimmed) return undefined;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void window.canvasWorkspace.agent.searchSessions(trimmed, SEARCH_LIMIT, 'title')
        .then((result) => {
          if (cancelled || !result.ok) return;
          const commands = (result.hits ?? []).map((hit): PaletteCommand => ({
            id: `chat:${hit.workspaceId}:${hit.sessionId}`,
            title: hit.preview || hit.date,
            hint: [hit.workspaceName, hit.date].filter(Boolean).join(' · '),
            group: 'navigate',
            run: () => requestOpenChatSession({
              sessionId: hit.sessionId,
              storeId: hit.workspaceId,
              label: hit.workspaceName,
            }),
          }));
          setFound({ query: trimmed, commands });
        })
        .catch(() => {
          // Chat results are an extra; nodes and commands still work.
        });
    }, SEARCH_DELAY_MS);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [trimmed]);

  return found && found.query === trimmed ? found.commands : NO_COMMANDS;
};
