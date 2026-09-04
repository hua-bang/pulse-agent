import { describe, expect, it } from 'vitest';
import type { RuntimeSnapshot } from 'pulse-coder-agent-teams/runtime';
import {
  agentNodeIdsForAgents,
  inferPhase,
  metadataCanvasNodeIds,
  plannedStartupAgentIds,
} from './projection';

const snapshot = (value: unknown): RuntimeSnapshot => value as RuntimeSnapshot;

describe('agent team projection', () => {
  it('infers legacy phases without overriding persisted metadata', () => {
    const briefing = snapshot({ team: { status: 'active' }, agents: [], tasks: [] });
    expect(inferPhase(undefined, briefing)).toBe('briefing');
    expect(inferPhase({ phase: 'starting' } as never, briefing)).toBe('starting');
    expect(inferPhase(undefined, snapshot({
      team: { status: 'waiting_approval' }, agents: [], tasks: [],
    }))).toBe('plan_review');
    expect(inferPhase({ pendingPlan: {} } as never, briefing)).toBe('plan_review');
    expect(inferPhase(undefined, snapshot({
      team: { status: 'active' }, agents: [{ id: 'worker', role: 'teammate' }], tasks: [],
    }))).toBe('executing');
  });

  it('starts every teammate for unowned ready work and falls back from a lead-only set', () => {
    const agents = [
      { id: 'lead', role: 'lead' },
      { id: 'worker-a', role: 'teammate' },
      { id: 'worker-b', role: 'teammate' },
    ];
    expect(plannedStartupAgentIds(snapshot({
      team: { leadAgentId: 'lead' },
      agents,
      tasks: [{ id: 'ready', status: 'todo', deps: [] }],
    }))).toEqual(['lead', 'worker-a', 'worker-b']);
    expect(plannedStartupAgentIds(snapshot({
      team: { leadAgentId: 'lead' }, agents, tasks: [],
    }))).toEqual(['lead', 'worker-a']);
  });

  it('selects the lead and owners of ready tasks for startup', () => {
    const runtime = snapshot({
      team: { leadAgentId: 'lead' },
      agents: [
        { id: 'lead', role: 'lead' },
        { id: 'worker-a', role: 'teammate' },
        { id: 'worker-b', role: 'teammate' },
      ],
      tasks: [
        { id: 'done', status: 'done', deps: [] },
        { id: 'ready', status: 'todo', deps: ['done'], ownerAgentId: 'worker-b' },
        { id: 'blocked', status: 'todo', deps: ['ready'], ownerAgentId: 'worker-a' },
      ],
    });

    expect(plannedStartupAgentIds(runtime)).toEqual(['lead', 'worker-b']);
  });

  it('projects only existing canvas node ids', () => {
    const metadata = {
      frameNodeId: 'frame',
      agentNodeIds: { lead: 'node-lead', missing: '' },
    } as never;
    expect(agentNodeIdsForAgents(metadata, ['lead', 'missing', 'unknown'])).toEqual(['node-lead']);
    expect(metadataCanvasNodeIds(metadata)).toEqual(['frame', 'node-lead']);
  });
});
