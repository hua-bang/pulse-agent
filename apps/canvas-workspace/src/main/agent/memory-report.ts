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
 * ALL context — workspace listing, existing memory, and the period's
 * session excerpts — is gathered in code and inlined into the system prompt
 * under hard character budgets, and the run gets NO tools. Real-app testing
 * showed why: with tools, a heavy user's unbounded session_summary payload
 * made the follow-up LLM call slow enough to hit the wall clock, and prompt
 * -side parameter hints are not a reliable input bound. Code-side budgets
 * are. Generation is therefore a single bounded LLM call.
 */

import { promises as fs } from 'fs';
import { join } from 'path';
import { listWorkspaces } from '../canvas/workspaces';
import { addArtifactVersion, createArtifact, listArtifacts } from '../artifacts/store';
import { listMemory, memoryBaseDir, type MemoryEntry } from './memory-store';
import { GLOBAL_CHAT_SESSION_STORE_ID } from './session-store';
import { createSessionTools } from './tools/sessions';
import {
  runHeadlessAgentTask,
  type HeadlessEngineFactory,
  type HeadlessRunResult,
} from './headless-run';

export type MemoryReportPhase = 'reading' | 'writing';

export interface MemoryReportProgressEvent {
  phase: MemoryReportPhase;
}

export interface MemoryReportOptions {
  /** Reporting window in days. Default 7 (weekly). */
  days?: number;
  timeoutMs?: number;
  /** Coarse progress callback: reading sessions → writing the document. */
  onPhase?: (progress: MemoryReportProgressEvent) => void;
  /** External cancellation (the settings cancel button). */
  abortSignal?: AbortSignal;
  /** Test seam, forwarded to runHeadlessAgentTask. */
  engineFactory?: HeadlessEngineFactory;
}

const MAX_EXISTING_ENTRIES_PER_SCOPE = 50;
/** Hard input budget for the inlined session digest (~20K tokens). */
const SESSION_DIGEST_BUDGET_CHARS = 60_000;
const DIGEST_MAX_MESSAGES_PER_SESSION = 30;

interface SessionDigest {
  text: string;
  included: number;
  omitted: number;
}

/**
 * Pre-gather the period's chat excerpts by invoking the session_summary tool
 * in code, then enforce a recency-first character budget. The model never
 * controls the input volume.
 */
async function buildSessionsDigest(days: number): Promise<SessionDigest> {
  let parsed: {
    sessions?: Array<{ workspaceName?: string; workspaceId?: string; date?: string; excerpt?: string[] }>;
  };
  try {
    const raw = await createSessionTools().session_summary.execute({
      days,
      maxMessagesPerSession: DIGEST_MAX_MESSAGES_PER_SESSION,
    });
    parsed = JSON.parse(raw);
  } catch (err) {
    console.warn('[memory-report] failed to gather session digest:', err);
    return { text: '(session history could not be read)', included: 0, omitted: 0 };
  }

  const sessions = Array.isArray(parsed.sessions) ? parsed.sessions : [];
  const sorted = [...sessions].sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''));

  const blocks: string[] = [];
  let used = 0;
  let included = 0;
  for (const session of sorted) {
    const header = `— ${session.workspaceName ?? session.workspaceId ?? 'unknown'} · ${session.date ?? ''}`;
    const block = `${header}\n${(session.excerpt ?? []).join('\n')}`;
    if (included > 0 && used + block.length > SESSION_DIGEST_BUDGET_CHARS) break;
    blocks.push(block);
    used += block.length;
    included += 1;
  }
  const omitted = sessions.length - included;
  if (omitted > 0) {
    blocks.push(`(…${omitted} earlier sessions omitted to fit the input budget)`);
  }
  return {
    text: blocks.length > 0 ? blocks.join('\n\n') : '(no chat activity in this window)',
    included,
    omitted,
  };
}

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
  sessionsDigest: string,
): string {
  return [
    'You generate a periodic memory report for the Pulse Canvas user. This is a background run with NO tools: everything you need is below. Produce ONE final self-contained HTML document (`<!doctype html>` … `</html>`, all CSS inline, no external resources or scripts) and nothing else — no surrounding prose or code fences. Keep the styling at documentation density (simple readable typography, no marketing chrome). Do not attempt to save memory — adoption happens later in chat.',
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
    `## Chat activity in the window (pre-gathered excerpts, grouped by session)`,
    sessionsDigest,
    '',
    '## How to work',
    '1. Read the chat activity above — it is the complete input; there are no tools to call.',
    '2. Write the report (HTML body) in the user\'s dominant conversation language, structured as:',
    '   - A short overall summary (2-3 lines).',
    '   - Per-workspace sections (use workspace NAMES): what happened, decisions made, problems solved. Skip idle workspaces.',
    '   - "候选记忆" — a numbered list. Each item: ONE distilled statement (≤500 chars) + suggested scope written exactly as `[全局]` or `[工作区: <name> (<id>)]` + kind (preference/fact/decision/rule/note). If an item supersedes an existing entry, append "更新: 替代 [mem-…]".',
    '   - "候选 skills" (optional section, at most 2 items): ONLY when the SAME multi-step workflow succeeded at least twice this period and would clearly recur. Each item: a proposed skill name + one-line description + suggested scope (`[全局]` or `[工作区: <name>]`) + which conversations evidence it. A one-off task or a vague theme is NOT a skill candidate; omit the section entirely when nothing qualifies.',
    '   - Close by telling the user to reply in chat with the numbers they want to adopt (skills are saved via the save-as-skill flow after confirmation).',
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
    options.onPhase?.({ phase: 'reading' });
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

    const digest = await buildSessionsDigest(days);

    return await runHeadlessAgentTask(
      {
        label: 'memory-report',
        systemPrompt: buildSystemPrompt(days, workspaces, existingBlocks, digest.text),
        prompt: `Generate the memory report for the last ${days} days.`,
        // No tools: all input is pre-gathered and budgeted above, so the run
        // is a single bounded LLM call.
        // Heavy usage can still legitimately need minutes on slow models;
        // the run is observable and cancellable, so a generous ceiling
        // beats aborting real work.
        timeoutMs: options.timeoutMs ?? 10 * 60_000,
        onTextStart: () => options.onPhase?.({ phase: 'writing' }),
        abortSignal: options.abortSignal,
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

/** Artifact storage scope for reports — shared with global-chat sessions. */
export const GLOBAL_ARTIFACT_SCOPE_ID = GLOBAL_CHAT_SESSION_STORE_ID;

export function memoryReportsDir(): string {
  return join(memoryBaseDir(), 'reports');
}

/** Models often wrap HTML in a ```html fence despite instructions — unwrap it. */
function stripCodeFence(text: string): string {
  const match = text.trim().match(/^```(?:html)?\s*\n([\s\S]*?)\n```\s*$/);
  return match ? match[1] : text;
}

/**
 * The engine returns fallback prose (e.g. "Max steps reached…") when a run
 * ends without a final document — publishing that as the report artifact is
 * worse than failing. Accept only something that looks like an HTML document.
 */
function looksLikeHtmlDocument(text: string): boolean {
  return /<!doctype\s+html|<html[\s>]/i.test(text);
}

export type ScheduledMemoryReportResult = HeadlessRunResult & { path?: string; artifactId?: string };

/**
 * Scheduler task body: generate the report headlessly, persist the HTML under
 * `<memory>/reports/memory-report-YYYY-MM-DD.html` (same-day rerun overwrites;
 * oldest pruned beyond retention) as the on-disk archive, and publish it as a
 * global-scope artifact so the right dock can display it on any route.
 */
export async function runScheduledMemoryReport(
  options: MemoryReportOptions = {},
): Promise<ScheduledMemoryReportResult> {
  const result = await generateMemoryReport(options);
  if (!result.ok) return result;

  const html = stripCodeFence(result.text);
  if (!looksLikeHtmlDocument(html)) {
    const snippet = html.replace(/\s+/g, ' ').trim().slice(0, 160);
    console.warn('[memory-report] run finished without an HTML document:', snippet);
    return { ok: false, error: `模型未产出报告文档: ${snippet}` };
  }

  try {
    const stamp = new Date().toISOString().slice(0, 10);

    const dir = memoryReportsDir();
    await fs.mkdir(dir, { recursive: true });
    const path = join(dir, `memory-report-${stamp}.html`);
    await fs.writeFile(path, html, 'utf-8');

    const reports = (await fs.readdir(dir))
      .filter((name) => name.startsWith('memory-report-') && name.endsWith('.html'))
      .sort();
    for (const stale of reports.slice(0, Math.max(0, reports.length - REPORTS_KEEP))) {
      await fs.rm(join(dir, stale), { force: true });
    }

    // Same-day rerun (retry / try-it button) adds a version to the existing
    // report artifact instead of piling up duplicates in the global scope.
    const title = `记忆周报 ${stamp}`;
    const existing = (await listArtifacts(GLOBAL_ARTIFACT_SCOPE_ID)).find((a) => a.title === title);
    const artifact = existing
      ? await addArtifactVersion(GLOBAL_ARTIFACT_SCOPE_ID, existing.id, { content: html })
      : await createArtifact(GLOBAL_ARTIFACT_SCOPE_ID, { type: 'html', title, content: html });
    return { ok: true, text: html, path, artifactId: artifact?.id ?? existing?.id };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    console.warn('[memory-report] generated but failed to persist:', error);
    return { ok: false, error };
  }
}
