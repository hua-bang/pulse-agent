import { describe, expect, it } from 'vitest';
import type { ScheduledTask } from '../../shared/scheduled';
import type { CanvasActivitySnapshot } from './activity-collector';
import { buildDigestPrompt, extractHtmlDocument } from './digest-runner';

const sampleSnapshot: CanvasActivitySnapshot = {
  days: 1,
  cutoffMs: 0,
  collectedAt: 1_000,
  hasActivity: true,
  activeWorkspaceCount: 1,
  totalSessions: 1,
  totalCanvasChanges: 1,
  workspaces: [
    {
      workspaceId: 'ws-1',
      workspaceName: 'Alpha',
      sessions: [
        {
          sessionId: 's-1',
          workspaceId: 'ws-1',
          workspaceName: 'Alpha',
          date: '2026-11-21',
          lastActivityAt: 900,
          messageCount: 2,
          ref: '@[session:ws-1:s-1:|Alpha 2026-11-21]',
          excerpts: [{ role: 'user', text: 'Ship daily digest' }],
        },
      ],
      canvasChanges: [
        {
          nodeId: 'n-1',
          type: 'text',
          title: 'Design note',
          changeKind: 'created',
          timestamp: 950,
          snippet: 'Summarize sessions and canvas edits.',
        },
      ],
    },
  ],
};

const makeTask = (source: 'daily-summary' | 'memory-report'): ScheduledTask => ({
  id: source,
  title: source === 'daily-summary' ? 'Daily summary' : 'Memory report',
  prompt: 'Summarize activity.',
  schedule: source === 'daily-summary'
    ? { kind: 'daily', timeOfDay: '21:00' }
    : { kind: 'weekly', weekday: 1, timeOfDay: '09:00' },
  enabled: true,
  source,
  createdAt: 1,
  updatedAt: 1,
  nextRunAt: 2,
  runCount: 0,
  status: 'running',
});

describe('digest-runner', () => {
  it('extracts HTML documents from raw, fenced, and wrapped outputs', () => {
    const doc = '<!doctype html><html><body><h1>Digest</h1></body></html>';
    expect(extractHtmlDocument(doc)).toBe(doc);
    expect(extractHtmlDocument(`\`\`\`html\n${doc}\n\`\`\``)).toBe(doc);
    expect(extractHtmlDocument(`Here is your report:\n${doc}\nLet me know!`)).toBe(doc);
    expect(extractHtmlDocument('Just plain markdown without html')).toBeNull();
  });

  it('builds distinct daily vs weekly prompts with pre-collected activity', () => {
    const dailyPrompt = buildDigestPrompt({
      task: makeTask('daily-summary'),
      snapshot: sampleSnapshot,
    });
    expect(dailyPrompt).toContain('Daily Summary');
    expect(dailyPrompt).toContain('Open loops & Next up');
    expect(dailyPrompt).toContain('Design note');
    expect(dailyPrompt).not.toContain('Existing memory (dedupe');

    const weeklyPrompt = buildDigestPrompt({
      task: makeTask('memory-report'),
      snapshot: { ...sampleSnapshot, days: 7 },
      existingMemoryBlocks: ['Global:', '- [mem-1] (preference) Prefer concise replies'],
    });
    expect(weeklyPrompt).toContain('Weekly Summary');
    expect(weeklyPrompt).toContain('Existing memory (dedupe');
    expect(weeklyPrompt).toContain('Prefer concise replies');
    expect(weeklyPrompt).toContain('window.pulseArtifact');
  });
});
