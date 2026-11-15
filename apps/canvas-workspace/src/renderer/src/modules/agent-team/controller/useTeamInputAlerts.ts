import { useEffect, useRef } from 'react';
import type { AgentTeamSnapshot } from '../../../types';
import type { ToastInput } from '../../../types/ui-interaction';
import { isHumanFacingGate } from '../model/humanGates';

const REFRESH_DELAY_MS = 400;
const PROMPT_PREVIEW_LENGTH = 140;

interface Labels {
  title: (teamName: string) => string;
  open: string;
}

interface Options {
  /** Show a toast. */
  notify: (toast: ToastInput) => void;
  /** Open the workspace that owns the team. */
  openWorkspace: (workspaceId: string) => void;
  labels: Labels;
}

const promptPreview = (prompt: string): string => {
  const text = prompt.trim().replace(/\s+/g, ' ');
  return text.length > PROMPT_PREVIEW_LENGTH ? `${text.slice(0, PROMPT_PREVIEW_LENGTH).trimEnd()}…` : text;
};

/** Open gates that ask the user something, with the team that owns each. */
export const openHumanGates = (teams: AgentTeamSnapshot[]) => teams.flatMap((snapshot) => (
  (snapshot.runtime?.humanGates ?? [])
    .filter((gate) => gate.status === 'open' && isHumanFacingGate(gate))
    .map((gate) => ({ gate, team: snapshot.runtime.team }))
));

/**
 * Tell the user when an agent team asks for input, from any route. The team
 * frame shows the question only while it is on screen; this toast stays
 * until the user opens the workspace or closes it.
 *
 * Main broadcasts an `agent-teams` external update whenever team state
 * changes. Each burst for a workspace triggers one `list` call; a gate
 * shows its toast once.
 */
export const useTeamInputAlerts = ({ notify, openWorkspace, labels }: Options): void => {
  const latest = useRef({ notify, openWorkspace, labels });
  latest.current = { notify, openWorkspace, labels };

  useEffect(() => {
    const storeApi = window.canvasWorkspace?.store;
    const teamsApi = window.canvasWorkspace?.agentTeams;
    if (!storeApi?.onExternalUpdate || !teamsApi?.list) return undefined;

    const announced = new Set<string>();
    const timers = new Map<string, ReturnType<typeof setTimeout>>();
    let disposed = false;

    const check = async (workspaceId: string) => {
      const result = await teamsApi.list(workspaceId).catch(() => null);
      if (disposed || !result?.ok) return;
      for (const { gate, team } of openHumanGates(result.teams ?? [])) {
        if (announced.has(gate.id)) continue;
        announced.add(gate.id);
        const { notify: show, openWorkspace: open, labels: text } = latest.current;
        show({
          tone: 'info',
          title: text.title(team.name),
          description: promptPreview(gate.prompt),
          // The question waits on the user, so the toast waits too.
          autoCloseMs: 0,
          action: { label: text.open, onClick: () => open(workspaceId) },
        });
      }
    };

    const unsubscribe = storeApi.onExternalUpdate((event) => {
      if (event.source !== 'agent-teams' || timers.has(event.workspaceId)) return;
      timers.set(event.workspaceId, setTimeout(() => {
        timers.delete(event.workspaceId);
        void check(event.workspaceId);
      }, REFRESH_DELAY_MS));
    });

    return () => {
      disposed = true;
      unsubscribe();
      timers.forEach((timer) => clearTimeout(timer));
    };
  }, []);
};
