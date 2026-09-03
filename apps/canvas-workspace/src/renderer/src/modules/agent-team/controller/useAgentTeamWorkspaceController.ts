import { useCallback, useEffect, useRef, useState } from 'react';
import { count } from '../../../perf/counters';
import type { AgentTeamSnapshot, AgentTeamsApi } from '../../../types';

type PlanAction = 'confirm' | 'advance' | 'finalize';
type TeamAction = 'pause' | 'resume' | 'delete' | 'dispatch';

interface AgentTeamWorkspaceControllerOptions {
  api: AgentTeamsApi | undefined;
  workspaceId?: string;
  teamId?: string;
  workspaceActive: boolean;
}

interface SnapshotResult {
  ok: boolean;
  snapshot?: AgentTeamSnapshot;
  error?: string;
}

export const useAgentTeamWorkspaceController = ({
  api,
  workspaceId,
  teamId,
  workspaceActive,
}: AgentTeamWorkspaceControllerOptions) => {
  const [snapshot, setSnapshot] = useState<AgentTeamSnapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [planAction, setPlanAction] = useState<PlanAction | null>(null);
  const [teamAction, setTeamAction] = useState<TeamAction | null>(null);
  const refreshInFlight = useRef(false);
  const refreshQueued = useRef(false);

  const applySnapshot = useCallback((result: SnapshotResult, fallback: string): boolean => {
    if (result.ok && result.snapshot) {
      setSnapshot(result.snapshot);
      setError(null);
      return true;
    }
    setError(result.error ?? fallback);
    return false;
  }, []);

  const refresh = useCallback(async () => {
    if (!api || !workspaceId || !teamId) return;
    if (refreshInFlight.current) {
      refreshQueued.current = true;
      return;
    }
    refreshInFlight.current = true;
    try {
      setLoading(true);
      applySnapshot(await api.snapshot(workspaceId, teamId), 'Unable to load team.');
    } finally {
      setLoading(false);
      refreshInFlight.current = false;
      if (refreshQueued.current) {
        refreshQueued.current = false;
        void refresh();
      }
    }
  }, [api, applySnapshot, teamId, workspaceId]);

  useEffect(() => {
    if (!workspaceActive) return undefined;
    count('agent-team-frame-poll');
    void refresh();
    const timer = setInterval(() => {
      count('agent-team-frame-poll');
      void refresh();
    }, 15_000);
    return () => clearInterval(timer);
  }, [refresh, workspaceActive]);

  useEffect(() => {
    const storeApi = window.canvasWorkspace?.store;
    if (!storeApi?.onExternalUpdate || !workspaceId) return;
    return storeApi.onExternalUpdate((event) => {
      if (event.workspaceId === workspaceId && event.source === 'agent-teams') void refresh();
    });
  }, [refresh, workspaceId]);

  const briefLead = useCallback(async (content: string): Promise<boolean> => {
    if (!api || !workspaceId || !teamId || !content.trim()) return false;
    return applySnapshot(
      await api.briefLead(workspaceId, teamId, content.trim()),
      'Unable to brief the leader.',
    );
  }, [api, applySnapshot, teamId, workspaceId]);

  const runPlanAction = useCallback(async (action: PlanAction): Promise<void> => {
    if (!api || !workspaceId || !teamId || planAction) return;
    setPlanAction(action);
    try {
      const result = action === 'confirm'
        ? await api.confirmPlan(workspaceId, teamId)
        : action === 'advance'
          ? await api.advanceRound(workspaceId, teamId)
          : await api.finalizeFromCheckpoint(workspaceId, teamId);
      applySnapshot(result, action === 'confirm'
        ? 'Unable to confirm plan.'
        : action === 'advance'
          ? 'Unable to advance to next round.'
          : 'Unable to finalize team.');
    } finally {
      setPlanAction(null);
    }
  }, [api, applySnapshot, planAction, teamId, workspaceId]);

  const updatePlanTeammate = useCallback(async (name: string, agentType: string) => {
    if (!api || !workspaceId || !teamId) return;
    applySnapshot(
      await api.updatePlanTeammate(workspaceId, teamId, name, agentType),
      'Unable to update teammate agent.',
    );
  }, [api, applySnapshot, teamId, workspaceId]);

  const sendInput = useCallback(async (agentId: string, content: string): Promise<boolean> => {
    if (!api || !workspaceId || !teamId || !content.trim()) return false;
    return applySnapshot(
      await api.sendInput(workspaceId, teamId, agentId, content),
      'Unable to send command.',
    );
  }, [api, applySnapshot, teamId, workspaceId]);

  const runTeamAction = useCallback(async (action: Exclude<TeamAction, 'delete'>) => {
    if (!api || !workspaceId || !teamId || teamAction) return;
    setTeamAction(action);
    try {
      const result = action === 'pause'
        ? await api.pause(workspaceId, teamId)
        : action === 'resume'
          ? await api.resume(workspaceId, teamId)
          : await api.dispatch(workspaceId, teamId);
      applySnapshot(result, action === 'pause'
        ? 'Unable to pause the Agent Team.'
        : action === 'resume'
          ? 'Unable to resume the Agent Team.'
          : 'Unable to dispatch tasks.');
    } finally {
      setTeamAction(null);
    }
  }, [api, applySnapshot, teamAction, teamId, workspaceId]);

  const deleteTeam = useCallback(async (): Promise<string[] | null> => {
    if (!api || !workspaceId || !teamId || teamAction) return null;
    setTeamAction('delete');
    try {
      const result = await api.delete(workspaceId, teamId);
      if (!result.ok) {
        setError(result.error ?? 'Unable to delete the Agent Team.');
        return null;
      }
      setSnapshot(null);
      setError(null);
      return result.deletedNodeIds ?? [];
    } finally {
      setTeamAction(null);
    }
  }, [api, teamAction, teamId, workspaceId]);

  const answerGate = useCallback(async (gateId: string, answer: string): Promise<boolean> => {
    if (!api || !workspaceId || !answer.trim()) return false;
    return applySnapshot(
      await api.answerGate(workspaceId, gateId, answer.trim()),
      'Unable to answer gate.',
    );
  }, [api, applySnapshot, workspaceId]);

  return {
    snapshot,
    loading,
    error,
    planAction,
    teamAction,
    refresh,
    briefLead,
    confirmPlan: () => runPlanAction('confirm'),
    advanceRound: () => runPlanAction('advance'),
    finalizeCheckpoint: () => runPlanAction('finalize'),
    updatePlanTeammate,
    sendInput,
    pauseTeam: () => runTeamAction('pause'),
    resumeTeam: () => runTeamAction('resume'),
    dispatch: () => runTeamAction('dispatch'),
    deleteTeam,
    answerGate,
  };
};
