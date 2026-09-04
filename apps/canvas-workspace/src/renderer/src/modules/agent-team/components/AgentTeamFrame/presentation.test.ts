import { describe, expect, it } from 'vitest';
import type { AgentTeamSnapshot, FrameNodeData } from '../../../../types';
import { createAgentTeamFramePresentation } from './presentation';

describe('createAgentTeamFramePresentation', () => {
  it('projects checkpoint copy, progress, cwd, and available team actions', () => {
    const runtime: AgentTeamSnapshot['runtime'] = {
      team: {
        id: 'team-1',
        name: 'Renderer Team',
        goal: 'Refactor renderer',
        status: 'round_checkpoint',
        createdAt: 1,
        updatedAt: 2,
        metadata: { cwd: '/workspace/from-team' },
      },
      agents: [],
      tasks: [
        {
          id: 'done',
          teamId: 'team-1',
          title: 'Done',
          description: '',
          status: 'done',
          deps: [],
          createdBy: 'lead',
          createdAt: 1,
          updatedAt: 2,
        },
        {
          id: 'review',
          teamId: 'team-1',
          title: 'Review',
          description: '',
          status: 'needs_review',
          deps: [],
          createdBy: 'lead',
          createdAt: 1,
          updatedAt: 2,
        },
      ],
      artifacts: [],
      humanGates: [],
      messages: [],
      events: [],
      checkpointRound: 2,
    };

    const result = createAgentTeamFramePresentation({
      nodeId: 'frame:1',
      nodeTitle: 'Fallback',
      data: { agentTeamName: 'Draft Name' } as FrameNodeData,
      runtime,
      phase: 'executing',
      agents: [],
      teammates: [],
      graphTaskCount: 2,
      graphAgentCount: 1,
      rootFolder: '/workspace/fallback',
    });

    expect(result).toMatchObject({
      teamTitle: 'Renderer Team',
      teamCwd: '/workspace/from-team',
      phaseTitle: 'Round 2 Checkpoint',
      doneTaskCount: 1,
      activeTaskCount: 1,
      graphTitle: 'Live task graph',
      graphSubtitle: '2 tasks · 1 teammate',
      edgeMarkerId: 'agent-team-dag-arrow-frame-1',
      isCheckpoint: true,
      canPauseTeam: true,
      canResumeTeam: false,
      canDispatch: false,
    });
  });
});
