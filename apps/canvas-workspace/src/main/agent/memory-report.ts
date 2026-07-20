/**
 * Headless memory-report generation — the background half of memory-review.
 *
 * Produces the same report shape as the interactive `memory-review` skill
 * (per-workspace activity + numbered scope-labeled candidates) but WITHOUT
 * the adoption step: the run only gets read-only session tools, so it cannot
 * write memory, files, or canvas state. Adoption stays an interactive act —
 * the report tells the user to confirm candidates in chat, where the agent
 * uses `memory_adopt`.
 *
 * Context that the interactive skill fetches via tools (workspace listing,
 * existing memory) is gathered in code here and inlined into the system
 * prompt: fewer LLM round-trips, and the model can't skip the dedupe rubric.
 */

import { promises as fs } from 'fs';
import { join } from 'path';
import { listWorkspaces } from '../canvas/workspaces';
import { listMemory, memoryBaseDir, type MemoryEntry } from './memory-store';
import { createSessionTools } from './tools/sessions';
import {
  runHeadlessAgentTask,
  type HeadlessEngineFactory,
  type HeadlessRunResult,
} from './headless-run';

export interface MemoryReportOptions {
  /** Reporting window in days. Default 7 (weekly). */
  days?: number;
  timeoutMs?: number;
  /** Test seam, forwarded to runHeadlessAgentTask. */
  engineFactory?: HeadlessEngineFactory;
}

const MAX_EXISTING_ENTRIES_PER_SCOPE = 50;

function formatExistingEntries(label: string, entries: MemoryEntry[]): string[] {
  if (entries.length === 0) return [];
  const shown = entries.slice(0, MAX_EXISTING_ENTRIES_PER_SCOPE);
  const lines = [`${label}:`];
  for (const entry of shown) {
    lines.push(`- [${entry.id}] (${entry.kind}) ${entry.content}`);
  }
  if (entries.length > shown.length) {
    lines.push(`- …and ${entries.length - shown.length} more entries.`);
  }
  return lines;
}

function buildSystemPrompt(
  days: number,
  workspaces: Array<{ id: string; name: string }>,
  existingBlocks: string[],
): string {
  return [
    'You generate a periodic memory report for the Pulse Canvas user. This is a background run: produce ONE final markdown report and nothing else. Do not attempt to save memory — adoption happens later in chat.',
    '',
    `## Reporting window`,
    `The last ${days} days.`,
    '',
    '## Workspaces (id — name)',
    ...(workspaces.length > 0
      ? workspaces.map((w) => `- ${w.id} — ${w.name}`)
      : ['(none found)']),
    '',
    '## Existing memory (dedupe rubric — do NOT re-propose what is already covered)',
    ...(existingBlocks.length > 0 ? existingBlocks : ['(no saved memory yet)']),
    '',
    '## How to work',
    `1. Call \`session_summary\` with days=${days} to read the period's chat activity across all workspaces and global chat. Use \`session_search\` only if you need to locate a specific topic.`,
    '2. Write the report in the user\'s dominant conversation language, structured as:',
    '   - A short overall summary (2-3 lines).',
    '   - Per-workspace sections (use workspace NAMES): what happened, decisions made, problems solved. Skip idle workspaces.',
    '   - "候选记忆" — a numbered list. Each item: ONE distilled statement (≤500 chars) + suggested scope written exactly as `[全局]` or `[工作区: <name> (<id>)]` + kind (preference/fact/decision/rule/note). If an item supersedes an existing entry, append "更新: 替代 [mem-…]".',
    '   - Close by telling the user to reply in chat with the numbers they want to adopt.',
    '3. Precision over recall: 3 solid candidates beat 10 weak ones. Never propose transient task state, and never copy raw transcript excerpts — always distill.',
  ].join('\n');
}

/**
 * Generate the cross-workspace memory report headlessly. Returns the report
 * markdown in `text` on success; never throws.
 */
export async function generateMemoryReport(options: MemoryReportOptions = {}): Promise<HeadlessRunResult> {
  const days = options.days ?? 7;

  try {
    const { workspaces } = await listWorkspaces();

    const existingBlocks: string[] = [
      ...formatExistingEntries('Global', await listMemory({ kind: 'global' })),
    ];
    for (const workspace of workspaces) {
      existingBlocks.push(
        ...formatExistingEntries(
          `Workspace ${workspace.name} (${workspace.id})`,
          await listMemory({ kind: 'workspace', workspaceId: workspace.id }),
        ),
      );
    }

    const sessionTools = createSessionTools();

    return await runHeadlessAgentTask(
      {
        label: 'memory-report',
        systemPrompt: buildSystemPrompt(days, workspaces, existingBlocks),
        prompt: `Generate the memory report for the last ${days} days.`,
        tools: sessionTools,
        timeoutMs: options.timeoutMs,
      },
      ...(options.engineFactory ? [options.engineFactory] : []),
    );
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    console.warn('[memory-report] failed to prepare report context:', error);
    return { ok: false, error };
  }
}

// ─── Scheduled entry point ─────────────────────────────────────────

/** Rolling retention for persisted reports. */
const REPORTS_KEEP = 12;

export function memoryReportsDir(): string {
  return join(memoryBaseDir(), 'reports');
}

export type ScheduledMemoryReportResult = HeadlessRunResult & { path?: string };

/**
 * Scheduler task body: generate the report headlessly and persist it under
 * `<memory>/reports/memory-report-YYYY-MM-DD.md` (same-day rerun overwrites;
 * oldest reports pruned beyond the retention window). This on-disk file is
 * the interim delivery surface until the global-artifact surface exists —
 * the user reads it in chat ("看下最新记忆报告") or opens it directly.
 */
export async function runScheduledMemoryReport(
  options: MemoryReportOptions = {},
): Promise<ScheduledMemoryReportResult> {
  const result = await generateMemoryReport(options);
  if (!result.ok) return result;

  try {
    const dir = memoryReportsDir();
    await fs.mkdir(dir, { recursive: true });
    const stamp = new Date().toISOString().slice(0, 10);
    const path = join(dir, `memory-report-${stamp}.md`);
    await fs.writeFile(path, result.text, 'utf-8');

    const reports = (await fs.readdir(dir))
      .filter((name) => name.startsWith('memory-report-') && name.endsWith('.md'))
      .sort();
    for (const stale of reports.slice(0, Math.max(0, reports.length - REPORTS_KEEP))) {
      await fs.rm(join(dir, stale), { force: true });
    }
    return { ...result, path };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    console.warn('[memory-report] generated but failed to persist:', error);
    return { ok: false, error };
  }
}
