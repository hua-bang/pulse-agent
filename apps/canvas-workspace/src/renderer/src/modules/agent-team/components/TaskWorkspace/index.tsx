import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import './index.css';
import { SegmentedControl } from '../../../../components/ui';
import type { AgentDef } from '../../../../config/agentRegistry';
import type { AgentTeamArtifactRecord, AgentTeamPhase } from '../../../../types';
import {
  buildAgentTeamDagLayout,
  type AgentTeamGraphAgent,
  type AgentTeamGraphRound,
  type AgentTeamGraphTask,
  type AgentTeamRoundOption,
} from '../../model/workspaceModel';
import {
  AgentDetail,
  type AgentDetailMode,
  type AgentDetailModel,
  type AgentTerminalSurface,
} from '../AgentDetail';
import { AgentsStrip } from '../AgentsStrip';
import { TaskDagCanvas } from '../TaskDagCanvas';
import { TaskDetail } from '../TaskDetail';

export interface TaskWorkspaceView {
  markerId: string;
  phase: AgentTeamPhase;
  graphTitle: string;
  graphSubtitle: string;
  rounds: AgentTeamGraphRound[];
  roundOptions: AgentTeamRoundOption[];
  agents: AgentTeamGraphAgent[];
  selectedTask?: AgentTeamGraphTask;
  selectedAgentKey: string;
  selectedAgentDetail?: AgentDetailModel;
  agentTypeByOwnerKey: ReadonlyMap<string, string | undefined>;
  detailMode: 'task' | 'agent';
  agentViewMode: AgentDetailMode;
  taskArtifacts: AgentTeamArtifactRecord[];
  taskGate?: ReactNode;
  terminal?: AgentTerminalSurface;
  readOnly: boolean;
  agentOptions: AgentDef[];
  planAvailable?: boolean;
  planIntegrationVerify?: string;
  planAction: 'confirm' | 'advance' | 'finalize' | null;
  isCheckpoint?: boolean;
  checkpointRound?: number;
}

export interface TaskWorkspaceActions {
  selectTask: (task: AgentTeamGraphTask) => void;
  selectAgent: (agent: AgentTeamGraphAgent) => void;
  changeAgentType: (name: string, agentType: string) => void;
  changeDetailMode: (mode: 'task' | 'agent') => void;
  changeAgentViewMode: (mode: AgentDetailMode) => void;
  expandAgent: () => void;
  selectArtifact: (artifact: AgentTeamArtifactRecord) => void;
  confirmPlan: () => void;
  advanceRound: () => void;
  finalizeCheckpoint: () => void;
}

interface TaskWorkspaceProps {
  view: TaskWorkspaceView;
  actions: TaskWorkspaceActions;
}

export const TaskWorkspace = ({ view, actions }: TaskWorkspaceProps) => {
  const [selectedRound, setSelectedRound] = useState<number | null>(null);
  const [viewportHeight, setViewportHeight] = useState(0);
  const viewportRef = useRef<HTMLDivElement>(null);
  const activeRound = useMemo(() => {
    if (view.roundOptions.length === 0) return null;
    if (selectedRound != null && view.roundOptions.some((option) => option.round === selectedRound)) {
      return selectedRound;
    }
    return view.roundOptions[view.roundOptions.length - 1].round;
  }, [selectedRound, view.roundOptions]);
  const visibleRounds = useMemo(() => {
    if (view.rounds.length <= 1 || activeRound == null) return view.rounds;
    const matched = view.rounds.filter((group) => group.round === activeRound);
    return matched.length > 0 ? matched : view.rounds;
  }, [activeRound, view.rounds]);
  const layout = useMemo(
    () => buildAgentTeamDagLayout(visibleRounds, viewportHeight),
    [viewportHeight, visibleRounds],
  );

  useEffect(() => {
    const element = viewportRef.current;
    if (!element) return undefined;
    const updateHeight = (height: number) => {
      setViewportHeight((current) => current === height ? current : height);
    };
    updateHeight(Math.round(element.getBoundingClientRect().height));
    if (typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver((entries) => {
      updateHeight(Math.round(entries[0]?.contentRect.height ?? 0));
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const hasDetail = !!view.selectedTask || !!view.selectedAgentDetail;
  const agentActive = view.detailMode === 'agent';
  return (
    <section className="agent-team-graph-panel agent-team-graph-panel--inline" aria-label="Task Graph">
      <div className="agent-team-graph-panel__head">
        <div>
          <span className="agent-team-panel-heading__label">{view.graphTitle}</span>
          <strong>{view.graphSubtitle}</strong>
        </div>
        <div className="agent-team-graph-panel__actions">
          {view.roundOptions.length > 1 && (
            <SegmentedControl
              ariaPattern="tab"
              ariaLabel="Rounds"
              value={String(activeRound)}
              onChange={(id) => setSelectedRound(Number(id))}
              options={view.roundOptions.map((option) => ({
                id: String(option.round),
                title: `Round ${option.round} · ${option.doneCount}/${option.taskCount} done`,
                label: (
                  <>
                    <span className={`agent-team-task-row__dot agent-team-task-row__dot--${option.status}`} />
                    Round {option.round}
                  </>
                ),
              }))}
            />
          )}
          {view.phase === 'plan_review' && view.planIntegrationVerify && (
            <span className="agent-team-frame__hint" title={view.planIntegrationVerify}>
              Integration verify: <code>{view.planIntegrationVerify}</code>
            </span>
          )}
          {view.phase === 'plan_review' && view.planAvailable && (
            <button
              type="button"
              className="agent-team-frame__primary-action"
              onClick={actions.confirmPlan}
              disabled={view.readOnly || view.planAction !== null}
            >
              {view.planAction === 'confirm' ? 'Approving…' : 'Approve & Run'}
            </button>
          )}
          {view.isCheckpoint && (
            <>
              <button type="button" className="agent-team-frame__secondary-action" onClick={actions.finalizeCheckpoint} disabled={view.readOnly || view.planAction !== null}>
                {view.planAction === 'finalize' ? 'Finishing…' : 'Finish'}
              </button>
              <button type="button" className="agent-team-frame__primary-action" onClick={actions.advanceRound} disabled={view.readOnly || view.planAction !== null}>
                {view.planAction === 'advance' ? 'Starting…' : `Continue to Round ${(view.checkpointRound ?? 0) + 1}`}
              </button>
            </>
          )}
        </div>
      </div>
      <div className={`agent-team-graph-panel__main${hasDetail ? '' : ' agent-team-graph-panel__main--graph-only'}`}>
        <div ref={viewportRef} className="agent-team-task-graph" aria-label="Task dependency graph">
          {view.rounds.length === 0 ? (
            <div className="agent-team-graph-empty">
              <span className="agent-team-empty-panel__eyebrow">No graph yet</span>
              <strong>Waiting for Team Lead to propose tasks.</strong>
              <span>The graph appears after the lead submits a plan.</span>
            </div>
          ) : (
            <TaskDagCanvas
              layout={layout}
              markerId={view.markerId}
              selectedTask={view.selectedTask}
              selectedAgentKey={view.selectedAgentKey}
              agentTypeByOwnerKey={view.agentTypeByOwnerKey}
              onSelectTask={actions.selectTask}
            />
          )}
        </div>
        {hasDetail && (
          <aside className={`agent-team-graph-detail agent-team-graph-detail--tabbed${agentActive ? ' agent-team-graph-detail--agent' : ''}`} aria-label="Selected detail">
            <SegmentedControl
              className="agent-team-detail-tabs"
              ariaPattern="tab"
              ariaLabel="Detail view"
              value={view.detailMode}
              onChange={(id) => actions.changeDetailMode(id as 'task' | 'agent')}
              options={[{ id: 'task', label: 'Task' }, { id: 'agent', label: 'Agent' }]}
            />
            {agentActive ? (
              <AgentDetail
                detail={view.selectedAgentDetail}
                mode={view.agentViewMode}
                terminal={view.terminal}
                onModeChange={actions.changeAgentViewMode}
                onExpand={actions.expandAgent}
                onSelectTask={actions.selectTask}
                onSelectArtifact={actions.selectArtifact}
              />
            ) : (
              <TaskDetail
                task={view.selectedTask}
                artifacts={view.taskArtifacts}
                ownerAgentType={view.selectedTask?.ownerKey ? view.agentTypeByOwnerKey.get(view.selectedTask.ownerKey) : undefined}
                selectedAgentKey={view.selectedAgentKey}
                humanGate={view.taskGate}
                onSelectArtifact={actions.selectArtifact}
              />
            )}
          </aside>
        )}
      </div>
      <AgentsStrip
        agents={view.agents}
        selectedAgentKey={view.selectedAgentKey}
        selectedTaskOwnerKey={view.selectedTask?.ownerKey}
        planReview={view.phase === 'plan_review'}
        readOnly={view.readOnly}
        agentOptions={view.agentOptions}
        onSelect={actions.selectAgent}
        onChangeAgentType={actions.changeAgentType}
      />
    </section>
  );
};
