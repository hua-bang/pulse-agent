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
 * Runs a REAL agent loop (product decision 2026-07-20, revisiting an earlier
 * single-call design): report quality comes from the agent surveying the
 * period, drilling into the threads that matter, and cross-checking canvas
 * knowledge — so it gets the same read-only tool family as the global chat
 * agent, minus only the interactive clarify tool and memory writes (see
 * HEADLESS_EXCLUDED_TOOLS). Unattended-run reliability is enforced by
 * guardrails, not by capability cuts: output validation (a run that ends
 * without an HTML document is a failure, never published), a wall-clock
 * timeout, user-visible progress (tool-call counts), and cancellation.
 */

import { promises as fs } from 'fs';
import { join } from 'path';
import { listWorkspaces } from '../canvas/workspaces';
import { addArtifactVersion, createArtifact, listArtifacts, updateArtifact } from '../artifacts/store';
import { listMemory, memoryBaseDir, type MemoryEntry } from './memory-store';
import { GLOBAL_CHAT_SESSION_STORE_ID } from './session-store';
import { createGlobalCanvasTools } from './tools';
import type { CanvasTool } from './tools/types';
import {
  runHeadlessAgentTask,
  type HeadlessEngineFactory,
  type HeadlessRunResult,
} from './headless-run';

export type MemoryReportPhase = 'reading' | 'writing';

export interface MemoryReportProgressEvent {
  phase: MemoryReportPhase;
  /** Cumulative tool calls so far (reading phase only). */
  toolCalls?: number;
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

/**
 * The headless toolset IS the global chat agent's toolset (deliberate
 * alignment — future complex background tasks reuse it as-is), with exactly
 * two categories of exceptions:
 * - `canvas_ask_user`: an unattended run has no user to answer.
 * - memory writes (`memory_save`/`memory_forget`/`memory_adopt`): the memory
 *   product's invariant is that writes happen only with the user's explicit
 *   confirmation in chat — a background run must not hold a write path.
 */
export const HEADLESS_EXCLUDED_TOOLS = new Set([
  'canvas_ask_user',
  'memory_save',
  'memory_forget',
  'memory_adopt',
]);

/** Global-chat toolset aligned for unattended use (see HEADLESS_EXCLUDED_TOOLS). */
function buildReportTools(): Record<string, CanvasTool> {
  const tools: Record<string, CanvasTool> = {};
  for (const [name, tool] of Object.entries(createGlobalCanvasTools())) {
    if (!HEADLESS_EXCLUDED_TOOLS.has(name)) tools[name] = tool;
  }
  return tools;
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
): string {
  return [
    'You generate a periodic memory report for the Pulse Canvas user. This is an unattended background agent run with read-only research tools. Your FINAL message must be ONE self-contained HTML document (`<!doctype html>` … `</html>`, no external resources) and nothing else — no surrounding prose or code fences. You have no memory-write tools — adoption happens later in chat or via the in-page buttons.',
    '',
    '## Visual style (match the host app — REQUIRED)',
    'Embed the following <style> block VERBATIM in <head> and compose the page with its classes (.card per candidate, .badge for scope, .badge.kind for kind, .btn for actions, .row for card headers, .muted for meta text). You may add minimal layout-only CSS (margins/grid); never introduce other fonts, colors, or shadows.',
    REPORT_STYLE_KIT,
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
    `1. Survey: call \`session_summary\` ONCE with days=${days} and maxMessagesPerSession=30 — one call covers EVERY workspace and global chat; never call it per workspace.`,
    '2. Research selectively: drill into the few threads that matter with `session_summary` (a specific sessionId), `session_search`, or the knowledge/canvas read tools when a session references canvas content worth checking. Depth over sweep — do NOT re-read everything; each extra call must answer a specific question you can name.',
    '3. Write the report (HTML body) in the user\'s dominant conversation language, structured as:',
    '   - A short overall summary (2-3 lines).',
    '   - Per-workspace sections (use workspace NAMES): what happened, decisions made, problems solved. Skip idle workspaces.',
    '   - "候选记忆" — a numbered list. Each item: ONE distilled statement (≤500 chars) + suggested scope written exactly as `[全局]` or `[工作区: <name> (<id>)]` + kind (preference/fact/decision/rule/note). If an item supersedes an existing entry, append "更新: 替代 [mem-…]".',
    '   - "候选 skills" (up to 3 items; ALWAYS render this section): propose when a repeatable multi-step workflow succeeded and would clearly recur — prefer ≥2 occurrences, but ONE solid complete success with obvious reuse value qualifies. Each item: a proposed skill name + one-line description + suggested scope (`[全局]` or `[工作区: <name>]`) + evidence. A vague theme is NOT a candidate; when nothing qualifies, keep the section with one line explaining why.',
    '   - Make every candidate INTERACTIVE: the in-app viewer injects `window.pulseArtifact` (capabilities: memory.adopt, skill.save). Render each memory candidate with a 采纳 button and each skill candidate with a 保存 button, wired exactly like this (copy this helper into your document):',
    '     `<script>async function cap(btn,name,p){btn.disabled=true;const a=window.pulseArtifact;const fn=a&&(name==="memory.adopt"?a.memory.adopt:a.skill.save);const r=await(fn?fn(p):{ok:false,error:"仅应用内可用"});btn.textContent=r.ok?"✓ 已完成":(r.error||"失败");if(!r.ok)btn.disabled=false;}</script>`',
    '     memory button: `onclick="cap(this,\'memory.adopt\',{content:\'…\',kind:\'preference\'})"` — include `workspaceId:\'<id>\'` for workspace-scoped candidates, omit for 全局.',
    '     skill button: `onclick="cap(this,\'skill.save\',{name:\'…\',description:\'…\',body:\'…\',scope:\'workspace\',workspaceId:\'<id>\'})"` (or scope:\'global\'). Draft the full SKILL body yourself.',
    '   - Also close by noting the user can alternatively adopt in chat ("采纳 1、3").',
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

    let toolCalls = 0;
    return await runHeadlessAgentTask(
      {
        label: 'memory-report',
        systemPrompt: buildSystemPrompt(days, workspaces, existingBlocks),
        prompt: `Generate the memory report for the last ${days} days.`,
        // Full agent loop with the global agent's read-only tool family
        // (curated for unattended use). Same generous step ceiling as chat;
        // the wall clock, output validation, progress visibility, and the
        // cancel button are the reliability guardrails.
        tools: buildReportTools(),
        maxSteps: 200,
        timeoutMs: options.timeoutMs ?? 10 * 60_000,
        onToolCall: () => {
          toolCalls += 1;
          options.onPhase?.({ phase: 'reading', toolCalls });
        },
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

/** Runtime capabilities every report artifact declares (adopt-in-page UX). */
const REPORT_CAPABILITIES = ['memory.adopt', 'skill.save'];

/**
 * Fixed style kit distilled from the app's design tokens (renderer
 * styles.css :root — warm paper bg, ink text, Notion-blue accent, the app's
 * mono font stack, 8px radii, soft card shadows). The prompt requires the
 * model to embed this verbatim and compose with its classes, so report
 * visuals match the workspace instead of drifting per generation.
 */
const REPORT_STYLE_KIT = `<style>
:root{--bg:#f8f8f7;--surface:#fff;--border:#e8e5e0;--text:#37352f;--text-secondary:#787774;--text-muted:#b4b0a8;--accent:#2383e2;--accent-light:rgba(35,131,226,.08);--accent-border:rgba(35,131,226,.45);--success:#1f7a4d;--error:#c0392b;--radius:8px;--radius-sm:6px;--shadow-card:0 1px 3px rgba(0,0,0,.04),0 4px 12px rgba(0,0,0,.05)}
*{box-sizing:border-box}
body{background:var(--bg);color:var(--text);font:14px/1.7 "SF Mono","Fira Code","Cascadia Code",Menlo,monospace;margin:0 auto;padding:32px 40px;max-width:860px}
h1{font-size:20px;margin:0 0 4px}
h2{font-size:15px;margin:32px 0 12px;padding-bottom:8px;border-bottom:1px solid var(--border)}
h3{font-size:13px;margin:16px 0 8px;color:var(--text-secondary)}
p,li{font-size:13px}
.muted{color:var(--text-secondary);font-size:12px}
.card{background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);box-shadow:var(--shadow-card);padding:14px 16px;margin:10px 0}
.badge{display:inline-block;font-size:11px;padding:2px 8px;border-radius:999px;background:var(--accent-light);color:var(--accent);border:1px solid var(--accent-border);margin-right:6px}
.badge.kind{background:rgba(0,0,0,.04);color:var(--text-secondary);border-color:var(--border)}
.btn{font:inherit;font-size:12px;padding:5px 14px;border-radius:var(--radius-sm);border:1px solid var(--accent-border);background:var(--surface);color:var(--accent);cursor:pointer}
.btn:hover{background:var(--accent-light)}
.btn:disabled{color:var(--success);border-color:var(--border);background:transparent;cursor:default}
.row{display:flex;align-items:center;justify-content:space-between;gap:12px}
</style>`;

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
    let artifact;
    if (existing) {
      artifact = await addArtifactVersion(GLOBAL_ARTIFACT_SCOPE_ID, existing.id, { content: html });
      if (!existing.capabilities?.length) {
        await updateArtifact(GLOBAL_ARTIFACT_SCOPE_ID, existing.id, {
          capabilities: REPORT_CAPABILITIES,
        });
      }
    } else {
      artifact = await createArtifact(GLOBAL_ARTIFACT_SCOPE_ID, {
        type: 'html',
        title,
        content: html,
        capabilities: REPORT_CAPABILITIES,
      });
    }
    return { ok: true, text: html, path, artifactId: artifact?.id ?? existing?.id };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    console.warn('[memory-report] generated but failed to persist:', error);
    return { ok: false, error };
  }
}
