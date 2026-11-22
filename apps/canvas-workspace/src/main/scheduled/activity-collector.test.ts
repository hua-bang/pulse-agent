import { describe, expect, it } from 'vitest';
import {
  collectCanvasActivity,
  formatActivityBrief,
  formatActivityForPrompt,
} from './activity-collector';

const NOW = Date.UTC(2026, 10, 21, 12, 0, 0);
const HOUR = 3_600_000;

describe('collectCanvasActivity', () => {
  it('collects recent sessions and substantive canvas changes while filtering transient and scheduled noise', async () => {
    const snapshot = await collectCanvasActivity({
      days: 1,
      now: NOW,
      deps: {
        listWorkspaces: async () => ({
          workspaces: [
            { id: 'ws-alpha', name: 'Alpha' },
            { id: 'ws-idle', name: 'Idle' },
          ] as never,
        }),
        readAllSessions: async () => ([
          {
            workspaceName: 'Alpha',
            isCurrent: true,
            sortKey: NOW - 2 * HOUR,
            session: {
              sessionId: 'sess-1',
              workspaceId: 'ws-alpha',
              startedAt: new Date(NOW - 3 * HOUR).toISOString(),
              messages: [
                { role: 'user', content: 'Refactor the scheduler', timestamp: NOW - 3 * HOUR },
                { role: 'assistant', content: 'Done and verified.', timestamp: NOW - 2 * HOUR },
              ],
            },
          },
          {
            // Scheduled task's own session must be excluded to prevent self-summarization.
            workspaceName: 'Daily summary',
            isCurrent: false,
            sortKey: NOW - HOUR,
            session: {
              sessionId: 'sess-sched',
              workspaceId: '__scheduled__-daily-summary',
              startedAt: new Date(NOW - HOUR).toISOString(),
              messages: [{ role: 'user', content: 'Previous summary', timestamp: NOW - HOUR }],
            },
          },
          {
            // Older than 1-day window — excluded.
            workspaceName: 'Idle',
            isCurrent: false,
            sortKey: NOW - 48 * HOUR,
            session: {
              sessionId: 'sess-old',
              workspaceId: 'ws-idle',
              startedAt: new Date(NOW - 48 * HOUR).toISOString(),
              messages: [{ role: 'user', content: 'Old topic', timestamp: NOW - 48 * HOUR }],
            },
          },
        ] as never),
        loadCanvas: async (wsId) => {
          if (wsId !== 'ws-alpha') return { nodes: [], edges: [] } as never;
          return {
            nodes: [
              {
                id: 'node-created',
                type: 'text',
                title: 'Launch checklist',
                createdAt: NOW - 4 * HOUR,
                updatedAt: NOW - 4 * HOUR,
                data: { content: 'Ship daily digest card and tests.' },
              },
              {
                id: 'node-updated',
                type: 'mindmap',
                title: 'Roadmap',
                createdAt: NOW - 10 * 24 * HOUR,
                updatedAt: NOW - 1 * HOUR,
                data: { label: 'Q4 milestones' },
              },
              {
                // Transient terminal tick should be ignored.
                id: 'node-term',
                type: 'terminal',
                title: 'bash',
                createdAt: NOW - 10 * 24 * HOUR,
                updatedAt: NOW - 1000,
                data: {},
              },
            ],
            edges: [],
          } as never;
        },
        listWorkspaceNodes: async () => [],
      },
    });

    expect(snapshot.hasActivity).toBe(true);
    expect(snapshot.activeWorkspaceCount).toBe(1);
    expect(snapshot.totalSessions).toBe(1);
    expect(snapshot.totalCanvasChanges).toBe(2);
    expect(snapshot.workspaces[0]?.workspaceId).toBe('ws-alpha');
    expect(snapshot.workspaces[0]?.canvasChanges.map((c) => [c.nodeId, c.changeKind])).toEqual([
      ['node-updated', 'updated'],
      ['node-created', 'created'],
    ]);

    const promptText = formatActivityForPrompt(snapshot);
    expect(promptText).toContain('Alpha');
    expect(promptText).toContain('Launch checklist');
    expect(promptText).toContain('Refactor the scheduler');
    expect(promptText).not.toContain('Previous summary');
    expect(formatActivityBrief(snapshot)).toBe('1 workspaces · 1 sessions · 2 canvas changes');
  });

  it('reports hasActivity=false when nothing changed in the window', async () => {
    const snapshot = await collectCanvasActivity({
      days: 1,
      now: NOW,
      deps: {
        listWorkspaces: async () => ({ workspaces: [{ id: 'ws-1', name: 'Empty' }] as never }),
        readAllSessions: async () => [],
        loadCanvas: async () => ({ nodes: [], edges: [] } as never),
        listWorkspaceNodes: async () => [],
      },
    });

    expect(snapshot.hasActivity).toBe(false);
    expect(snapshot.totalSessions).toBe(0);
    expect(snapshot.totalCanvasChanges).toBe(0);
    expect(formatActivityBrief(snapshot)).toBe('No new activity');
  });
});
