import './index.css';
import { useEffect, useMemo, useState } from 'react';
import { NodeMentionPicker } from '../NodeMentionPicker';
import { AgentPicker } from './AgentPicker';
import { AgentRestart } from './AgentRestart';
import { AgentTeamManaged } from './AgentTeamManaged';
import { AgentTerminal } from './AgentTerminal';
import type { AgentTeamEventRecord, AgentTeamSnapshot } from '../../types';
import type { AgentNodeBodyProps } from './types';
import { detectAgentView, useAgentNodeController } from './useAgentNodeController';

export { detectAgentView };

const asString = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() ? value : undefined;

const describeTeamLeadEvent = (
  snapshot: AgentTeamSnapshot,
  event: AgentTeamEventRecord,
): string | undefined => {
  const taskId = asString(event.payload.taskId);
  const agentId = asString(event.payload.agentId);
  const artifactId = asString(event.payload.artifactId);
  const status = asString(event.payload.status);
  const task = taskId ? snapshot.runtime.tasks.find((item) => item.id === taskId) : undefined;
  const agent = agentId ? snapshot.runtime.agents.find((item) => item.id === agentId) : undefined;
  const artifact = artifactId ? snapshot.runtime.artifacts.find((item) => item.id === artifactId) : undefined;

  switch (event.type) {
    case 'team_status_changed':
      return status ? `Team moved to ${status.replace(/_/g, ' ')}.` : undefined;
    case 'task_created':
      return `Created task: ${task?.title ?? 'New task'}.`;
    case 'task_assigned':
      return `Assigned ${task?.title ?? 'a task'} to ${agent?.name ?? 'a teammate'}.`;
    case 'task_completed':
      return `Completed: ${task?.title ?? 'A team task'}.`;
    case 'task_blocked':
      return `Blocked: ${task?.title ?? 'A team task'}.`;
    case 'task_failed':
      return `Failed: ${task?.title ?? 'A team task'}.`;
    case 'task_needs_review':
      return `Needs review: ${task?.title ?? 'A team task'}.`;
    case 'artifact_created':
      return `Published artifact: ${artifact?.title ?? task?.title ?? 'Team artifact'}.`;
    case 'human_gate_opened':
      return `Asked for input on ${task?.title ?? 'the team run'}.`;
    case 'human_gate_answered':
      return `Received an answer for ${task?.title ?? 'a team question'}.`;
    case 'message_sent':
      return agent ? `Sent an instruction to ${agent.name}.` : undefined;
    case 'runtime_error':
      return 'Runtime reported an error.';
    default:
      return undefined;
  }
};

const summarizeTeamLeadActions = (snapshot: AgentTeamSnapshot | null): string[] => {
  if (!snapshot) return [];
  const seen = new Set<string>();
  return [...snapshot.runtime.events]
    .sort((a, b) => b.timestamp - a.timestamp)
    .map((event) => describeTeamLeadEvent(snapshot, event))
    .filter((action): action is string => {
      if (!action || seen.has(action)) return false;
      seen.add(action);
      return true;
    })
    .slice(0, 3);
};

export const AgentNodeBody = ({
  node,
  getAllNodes,
  rootFolder,
  workspaceId,
  teamLeadBriefSlot,
  agentTeamStatus,
  onUpdate,
  readOnly = false,
  terminalMode = 'owner',
  forceTeamWarmup = false,
}: AgentNodeBodyProps) => {
  const controller = useAgentNodeController({
    node,
    getAllNodes,
    rootFolder,
    workspaceId,
    onUpdate,
    readOnly,
    terminalMode,
    forceTeamWarmup,
  });
  const [leadSnapshot, setLeadSnapshot] = useState<AgentTeamSnapshot | null>(null);
  const isTeamLead = controller.data.agentTeamRole === 'lead';
  const leadRecentActions = useMemo(() => summarizeTeamLeadActions(leadSnapshot), [leadSnapshot]);
  const leadTeamStatus = agentTeamStatus ?? leadSnapshot?.runtime.team.status;
  const suppressFinishedTeamLeadRestart = isTeamLead
    && controller.viewMode === 'restart'
    && (leadTeamStatus === 'completed' || leadTeamStatus === 'failed');
  const managedLeadStatus = leadTeamStatus === 'completed'
    ? 'done'
    : leadTeamStatus === 'failed'
      ? 'error'
      : controller.status;

  useEffect(() => {
    const teamId = controller.data.agentTeamId;
    if (!isTeamLead || !workspaceId || !teamId) {
      setLeadSnapshot(null);
      return undefined;
    }

    let cancelled = false;
    const loadSnapshot = async () => {
      const result = await window.canvasWorkspace?.agentTeams?.snapshot(workspaceId, teamId);
      if (cancelled) return;
      if (result?.ok && result.snapshot) {
        setLeadSnapshot(result.snapshot);
      }
    };

    void loadSnapshot();
    const timer = window.setInterval(() => {
      void loadSnapshot();
    }, 5000);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [controller.data.agentTeamId, isTeamLead, workspaceId]);

  const terminalView = (
    <>
      {!readOnly && controller.pickerOpen && (
        <NodeMentionPicker
          nodes={controller.visibleNodes}
          onSelect={controller.handleMentionSelect}
          onClose={controller.handleMentionClose}
        />
      )}
      <AgentTerminal
        containerRef={controller.containerRef}
        status={controller.status}
        agentType={controller.data.agentType || 'claude-code'}
        cwd={controller.data.cwd}
        loading={controller.loading || controller.teamAutoResumePending}
      />
    </>
  );

  if (isTeamLead && (controller.viewMode === 'running' || controller.teamAutoResumePending)) {
    return (
      <div className="agent-team-lead-console agent-team-lead-console--bare">
        <div className="agent-team-lead-console__terminal">
          {terminalView}
        </div>
      </div>
    );
  }

  if (controller.teamAutoResumePending) {
    return terminalView;
  }

  if (suppressFinishedTeamLeadRestart) {
    return (
      <AgentTeamManaged
        agentType={controller.data.agentType || controller.selectedAgent || 'claude-code'}
        cwd={controller.data.cwd || rootFolder}
        status={managedLeadStatus}
        lastPrompt={controller.data.lastInitPrompt}
        recentActions={leadRecentActions}
        commandSlot={teamLeadBriefSlot}
      />
    );
  }

  if (controller.viewMode === 'setup') {
    return (
      <AgentPicker
        selectedAgent={controller.selectedAgent}
        cwdInput={controller.cwdInput}
        promptInput={controller.promptInput}
        dangerousMode={controller.dangerousMode}
        rootFolder={rootFolder}
        recentCwds={controller.recentCwds}
        variant={isTeamLead ? 'team-lead' : 'default'}
        teamLeadBriefSlot={isTeamLead ? teamLeadBriefSlot : undefined}
        onBack={controller.fromRestart ? controller.handleBackToRestart : undefined}
        onAgentChange={controller.setSelectedAgent}
        onCwdChange={controller.setCwdInput}
        onPromptChange={controller.setPromptInput}
        onDangerousModeChange={controller.setDangerousMode}
        onPickFolder={controller.handlePickFolder}
        onLaunch={controller.handleLaunch}
      />
    );
  }

  if (controller.viewMode === 'restart') {
    return (
      <div className={isTeamLead ? 'agent-team-lead-advanced' : undefined}>
        <AgentRestart
          agentType={controller.data.agentType || 'claude-code'}
          cwd={controller.data.cwd}
          prompt={controller.data.lastInitPrompt}
          cliSessionId={controller.data.cliSessionId}
          codexSessionId={controller.data.codexSessionId}
          onRestart={controller.handleRestartSession}
          onEdit={controller.handleEditInit}
        />
      </div>
    );
  }

  if (isTeamLead) {
    return (
      <AgentTeamManaged
        agentType={controller.data.agentType || controller.selectedAgent || 'claude-code'}
        cwd={controller.data.cwd || rootFolder}
        status={managedLeadStatus}
        lastPrompt={controller.data.lastInitPrompt}
        recentActions={leadRecentActions}
        commandSlot={teamLeadBriefSlot}
      />
    );
  }

  return terminalView;
};
