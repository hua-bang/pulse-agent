import type { ScheduledTask, ScheduledTaskSource } from '../../shared/scheduled';
import { describeSchedule } from '../../shared/scheduled';
import { addArtifactVersion, createArtifact, listArtifacts, updateArtifact } from '../artifacts/store';
import { listWorkspaces } from '../canvas/workspaces';
import { listMemory, type MemoryEntry } from '../agent/memory/memory-store';
import {
  GLOBAL_ARTIFACT_SCOPE_ID,
  REPORT_CAPABILITIES,
  REPORT_STYLE_KIT,
  looksLikeHtmlDocument,
  stripCodeFence,
} from '../agent/memory/memory-report';
import {
  formatActivityForPrompt,
  type CanvasActivitySnapshot,
} from './activity-collector';

const MAX_EXISTING_ENTRIES_PER_SCOPE = 40;

export function digestDaysForSource(source: ScheduledTaskSource): number {
  return source === 'daily-summary' ? 1 : 7;
}

function formatMemoryEntries(label: string, entries: MemoryEntry[]): string[] {
  if (entries.length === 0) return [];
  const shown = entries.slice(0, MAX_EXISTING_ENTRIES_PER_SCOPE);
  const lines = [`${label}:`];
  for (const entry of shown) {
    lines.push(`- [${entry.id}] (${entry.kind}) ${entry.content}`);
  }
  if (entries.length > shown.length) {
    lines.push(`- …and ${entries.length - shown.length} more.`);
  }
  return lines;
}

export async function collectExistingMemoryBlocks(): Promise<string[]> {
  try {
    const { workspaces } = await listWorkspaces();
    const blocks: string[] = [
      ...formatMemoryEntries('Global', await listMemory({ kind: 'global' })),
    ];
    for (const ws of workspaces) {
      blocks.push(
        ...formatMemoryEntries(
          `Workspace ${ws.name} (${ws.id})`,
          await listMemory({ kind: 'workspace', workspaceId: ws.id }),
        ),
      );
    }
    return blocks;
  } catch {
    return [];
  }
}

export function buildDigestPrompt(params: {
  task: ScheduledTask;
  snapshot: CanvasActivitySnapshot;
  existingMemoryBlocks?: string[];
}): string {
  const { task, snapshot, existingMemoryBlocks = [] } = params;
  const isDaily = task.source === 'daily-summary';
  const windowLabel = isDaily ? 'last 24 hours (Daily Summary)' : 'last 7 days (Weekly Summary)';

  const sections = isDaily
    ? [
        '   - **Overview**: 2-3 lines summarizing today across all active workspaces.',
        '   - **Per-workspace highlights** (skip idle workspaces): combine both chat progress and canvas node changes (created/updated).',
        '   - **Open loops & Next up**: concrete unfinished items, pending decisions, or logical next steps for tomorrow.',
      ]
    : [
        '   - **Overview**: 2-3 lines summarizing the week across all active workspaces.',
        '   - **Per-workspace milestones & canvas changes** (skip idle workspaces): decisions made, problems solved, and key canvas additions/updates.',
        '   - **候选记忆 / Candidate memories**: numbered `.card` items. Each item: one distilled statement (≤500 chars), scope `[全局]` or `[工作区: <name> (<id>)]`, kind (`preference`/`fact`/`decision`/`rule`/`note`). Do NOT re-propose entries already in Existing memory. Include an interactive 采纳 button.',
        '   - **候选 skills / Candidate skills** (up to 3): reusable multi-step workflows that succeeded this week, each with a 保存 button (or one line stating none qualified).',
      ];

  const interactiveSnippet = isDaily
    ? []
    : [
        '## Interactive buttons (required for weekly candidates)',
        'Embed this helper in `<script>` so the in-app artifact viewer (`window.pulseArtifact`) can adopt directly:',
        '`<script>async function cap(btn,name,p){btn.disabled=true;const a=window.pulseArtifact;const fn=a&&(name==="memory.adopt"?a.memory.adopt:a.skill.save);const r=await(fn?fn(p):{ok:false,error:"仅应用内可用"});btn.textContent=r.ok?"✓ 已完成":(r.error||"失败");if(!r.ok)btn.disabled=false;}</script>`',
        '- Memory button: `onclick="cap(this,\'memory.adopt\',{content:\'…\',kind:\'preference\'})"` (add `workspaceId:\'<id>\'` for workspace scope).',
        '- Skill button: `onclick="cap(this,\'skill.save\',{name:\'…\',description:\'…\',body:\'…\',scope:\'workspace\',workspaceId:\'<id>\'})"` (or `scope:\'global\'`).',
        '',
      ];

  const existingMemorySection = isDaily
    ? []
    : [
        '## Existing memory (dedupe — do NOT re-propose)',
        ...(existingMemoryBlocks.length > 0 ? existingMemoryBlocks : ['(none saved yet)']),
        '',
      ];

  return [
    `Scheduled task: ${task.title}`,
    `Task ID: ${task.id}`,
    `Cadence: ${describeSchedule(task.schedule)}`,
    `Window: ${windowLabel}`,
    '',
    '## User instructions',
    task.prompt,
    '',
    '## Pre-collected activity (chat sessions + substantive canvas changes)',
    formatActivityForPrompt(snapshot),
    '',
    ...existingMemorySection,
    '## Output contract (REQUIRED)',
    '1. The pre-collected activity above already covers all active workspaces. Only call read-only tools (`session_summary`, `session_search`, `knowledge_read_node`) if you need deeper detail on a specific item.',
    '2. Unattended run: do NOT ask clarifying questions and do NOT mutate files, memory, or canvas state.',
    '3. Write your FINAL response as ONE self-contained HTML document (`<!doctype html>` … `</html>`, no external resources, no surrounding prose or code fences) in the user\'s dominant conversation language.',
    '4. Embed the following `<style>` verbatim in `<head>` and compose using `.card`, `.badge`, `.badge.kind`, `.btn`, `.row`, `.muted`:',
    REPORT_STYLE_KIT,
    '',
    '5. Structure the report body with:',
    ...sections,
    '',
    ...interactiveSnippet,
    '6. Keep it concise, factual, and scannable. If there was no activity, state that clearly in a short card.',
  ].join('\n');
}

/** Extract a self-contained HTML document even if the model added brief wrapper text. */
export function extractHtmlDocument(rawOutput: string): string | null {
  const unwrapped = stripCodeFence(rawOutput).trim();
  if (looksLikeHtmlDocument(unwrapped)) {
    const startMatch = unwrapped.match(/<!doctype\s+html|<html[\s>]/i);
    if (!startMatch || startMatch.index === undefined) return unwrapped;
    const endIdx = unwrapped.toLowerCase().lastIndexOf('</html>');
    if (endIdx >= startMatch.index) {
      return unwrapped.slice(startMatch.index, endIdx + '</html>'.length);
    }
    return unwrapped.slice(startMatch.index);
  }
  return null;
}

export async function persistDigestArtifact(params: {
  source: ScheduledTaskSource;
  rawOutput: string;
  now?: number;
}): Promise<string | undefined> {
  const html = extractHtmlDocument(params.rawOutput);
  if (!html) return undefined;

  const stamp = new Date(params.now ?? Date.now()).toISOString().slice(0, 10);
  const title = params.source === 'daily-summary'
    ? `每日总结 ${stamp}`
    : `每周总结 ${stamp}`;

  const existing = (await listArtifacts(GLOBAL_ARTIFACT_SCOPE_ID)).find((a) => a.title === title);
  if (existing) {
    const updated = await addArtifactVersion(GLOBAL_ARTIFACT_SCOPE_ID, existing.id, { content: html });
    if (!existing.capabilities?.length) {
      await updateArtifact(GLOBAL_ARTIFACT_SCOPE_ID, existing.id, {
        capabilities: REPORT_CAPABILITIES,
      });
    }
    return updated?.id ?? existing.id;
  }

  const created = await createArtifact(GLOBAL_ARTIFACT_SCOPE_ID, {
    type: 'html',
    title,
    content: html,
    capabilities: REPORT_CAPABILITIES,
  });
  return created.id;
}
