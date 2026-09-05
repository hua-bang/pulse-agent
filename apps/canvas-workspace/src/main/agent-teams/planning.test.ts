import { describe, expect, it } from 'vitest';
import {
  planDraftFromUnknown,
  resolvePlanTaskGraph,
} from './planning';

describe('agent team planning', () => {
  it('normalizes a JSON plan and supplies executable defaults', () => {
    const plan = planDraftFromUnknown(JSON.stringify({ summary: 'Ship it' }), 'lead-1', 42);

    expect(plan).toMatchObject({
      summary: 'Ship it',
      sourceAgentId: 'lead-1',
      createdAt: 42,
      teammates: [{ name: 'Codex Exec', agentType: 'codex' }],
      tasks: [{
        title: 'Execute approved plan',
        description: 'Ship it',
        ownerName: 'Codex Exec',
        deps: [],
      }],
    });
  });

  it('resolves case-insensitive dependency titles and deduplicates edges', () => {
    const resolved = resolvePlanTaskGraph([
      { title: 'Build', description: 'Build', deps: [] },
      { title: 'Verify', description: 'Verify', deps: ['build', ' Build '] },
    ]);
    const build = resolved.find((item) => item.task.title === 'Build');
    const verify = resolved.find((item) => item.task.title === 'Verify');

    expect(verify?.depIds).toEqual([build?.id]);
  });

  it('rejects duplicate titles, unknown dependencies, and cycles', () => {
    expect(() => resolvePlanTaskGraph([
      { title: 'Same', description: 'A', deps: [] },
      { title: ' same ', description: 'B', deps: [] },
    ])).toThrow(/Duplicate task title/);
    expect(() => resolvePlanTaskGraph([
      { title: 'A', description: 'A', deps: ['missing'] },
    ])).toThrow(/Unknown task dependency/);
    expect(() => resolvePlanTaskGraph([
      { title: 'A', description: 'A', deps: ['B'] },
      { title: 'B', description: 'B', deps: ['A'] },
    ])).toThrow(/Task dependency cycle detected/);
  });

  it('rejects plans beyond the bounded teammate and task limits', () => {
    expect(() => planDraftFromUnknown({
      teammates: Array.from({ length: 7 }, (_, index) => `Agent ${index}`),
    }, 'lead-1', 1)).toThrow(/maximum is 6/);
    expect(() => planDraftFromUnknown({
      tasks: Array.from({ length: 21 }, (_, index) => ({
        title: `Task ${index}`,
        description: 'Work',
        deps: [],
      })),
    }, 'lead-1', 1)).toThrow(/maximum is 20/);
  });
});
