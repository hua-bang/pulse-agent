/**
 * Long-term memory for the Canvas Agent — two scopes, one tiny store.
 *
 * Storage layout:
 *   ~/.pulse-coder/canvas/memory/
 *   ├── global.json               ← global memory (applies in every chat)
 *   └── workspaces/<id>.json      ← per-workspace memory
 *
 * Design intent (decided 2026-07-19, replacing a planned reuse of
 * packages/memory-plugin): memory volume in this product is small — a
 * handful of stable user preferences plus per-workspace decisions — so the
 * whole scope is injected into the system prompt verbatim (recency-ordered,
 * char-budgeted) instead of score-ranked recall, and writes happen only
 * through explicit `memory_save` tool calls. No regex auto-extraction, no
 * embeddings, no native deps.
 */

import { promises as fs } from 'fs';
import { dirname, join } from 'path';
import { homedir } from 'os';

// Read lazily (not a module-level const derived at import time) so tests can
// point it at an isolated tmpdir via the env var without needing vi.mock.
const memoryDir = (): string =>
  process.env.PULSE_CANVAS_MEMORY_DIR || join(homedir(), '.pulse-coder', 'canvas', 'memory');

/** Base directory of all memory data (entry files + derived artifacts like reports). */
export function memoryBaseDir(): string {
  return memoryDir();
}

export type MemoryScope =
  | { kind: 'global' }
  | { kind: 'workspace'; workspaceId: string };

export type MemoryKind = 'preference' | 'fact' | 'decision' | 'rule' | 'note';

export interface MemoryEntry {
  id: string;
  content: string;
  kind: MemoryKind;
  createdAt: number;
  updatedAt: number;
}

interface MemoryFile {
  version: 1;
  entries: MemoryEntry[];
}

/** Hard limits keeping both the files and the prompt injection bounded. */
export const MEMORY_MAX_CONTENT_CHARS = 500;
export const MEMORY_MAX_ENTRIES_PER_SCOPE = 200;
/** Per-scope char budget for the system-prompt injection. */
const PROMPT_BUDGET_PER_SCOPE = 4000;

function sanitizeFileKey(value: string): string {
  return value.trim().replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'default';
}

export function memoryFilePath(scope: MemoryScope): string {
  return scope.kind === 'global'
    ? join(memoryDir(), 'global.json')
    : join(memoryDir(), 'workspaces', `${sanitizeFileKey(scope.workspaceId)}.json`);
}

function normalizeContent(value: string): string {
  return value.replace(/\s+/g, ' ').trim().toLowerCase();
}

async function readFileEntries(path: string): Promise<MemoryEntry[]> {
  try {
    const raw = await fs.readFile(path, 'utf-8');
    const parsed = JSON.parse(raw) as MemoryFile;
    if (!Array.isArray(parsed.entries)) return [];
    return parsed.entries.filter(
      (e): e is MemoryEntry => Boolean(e) && typeof e.id === 'string' && typeof e.content === 'string',
    );
  } catch {
    return [];
  }
}

// Serialize read-modify-write cycles per file path so concurrent agents
// (global chat + several workspace chats all share global.json) can't race
// the temp-file rename — same failure mode session-store.ts guards against.
const writeQueues = new Map<string, Promise<unknown>>();

function withFileQueue<T>(path: string, task: () => Promise<T>): Promise<T> {
  const prev = writeQueues.get(path) ?? Promise.resolve();
  const next = prev.catch(() => undefined).then(task);
  writeQueues.set(path, next.catch(() => undefined));
  return next;
}

async function writeFileEntries(path: string, entries: MemoryEntry[]): Promise<void> {
  await fs.mkdir(dirname(path), { recursive: true });
  const payload: MemoryFile = { version: 1, entries };
  const tmp = `${path}.tmp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  await fs.writeFile(tmp, JSON.stringify(payload, null, 2), 'utf-8');
  await fs.rename(tmp, path);
}

export async function listMemory(scope: MemoryScope): Promise<MemoryEntry[]> {
  const path = memoryFilePath(scope);
  await writeQueues.get(path)?.catch(() => undefined);
  return readFileEntries(path);
}

export interface SaveMemoryResult {
  entry: MemoryEntry;
  /** True when the content deduped into an existing entry instead of appending. */
  updated: boolean;
}

export async function saveMemory(
  scope: MemoryScope,
  content: string,
  kind: MemoryKind = 'note',
): Promise<SaveMemoryResult> {
  const trimmed = content.trim();
  if (!trimmed) {
    throw new Error('Memory content is empty.');
  }
  if (trimmed.length > MEMORY_MAX_CONTENT_CHARS) {
    throw new Error(
      `Memory content is ${trimmed.length} chars; max is ${MEMORY_MAX_CONTENT_CHARS}. Save a shorter distilled statement instead.`,
    );
  }

  const path = memoryFilePath(scope);
  return withFileQueue(path, async () => {
    const entries = await readFileEntries(path);
    const normalized = normalizeContent(trimmed);
    const existing = entries.find((e) => normalizeContent(e.content) === normalized);
    const now = Date.now();

    if (existing) {
      existing.content = trimmed;
      existing.kind = kind;
      existing.updatedAt = now;
      await writeFileEntries(path, entries);
      return { entry: existing, updated: true };
    }

    if (entries.length >= MEMORY_MAX_ENTRIES_PER_SCOPE) {
      throw new Error(
        `This memory scope already holds ${entries.length} entries (max ${MEMORY_MAX_ENTRIES_PER_SCOPE}). Use memory_forget to drop stale entries first.`,
      );
    }

    const entry: MemoryEntry = {
      id: `mem-${now}-${Math.random().toString(36).slice(2, 8)}`,
      content: trimmed,
      kind,
      createdAt: now,
      updatedAt: now,
    };
    entries.push(entry);
    await writeFileEntries(path, entries);
    return { entry, updated: false };
  });
}

export interface ForgetMemoryResult {
  removed: MemoryEntry[];
  /** Entries a non-id query matched when it matched more than one (nothing removed). */
  ambiguous?: MemoryEntry[];
}

/**
 * Remove memory by exact id, or by substring query. A query that matches
 * multiple entries removes nothing and returns them as `ambiguous` so the
 * caller can re-issue with a specific id.
 */
export async function forgetMemory(
  scope: MemoryScope,
  selector: { id?: string; query?: string },
): Promise<ForgetMemoryResult> {
  const path = memoryFilePath(scope);
  return withFileQueue(path, async () => {
    const entries = await readFileEntries(path);

    if (selector.id) {
      const removed = entries.filter((e) => e.id === selector.id);
      if (removed.length === 0) return { removed: [] };
      await writeFileEntries(path, entries.filter((e) => e.id !== selector.id));
      return { removed };
    }

    const query = normalizeContent(selector.query ?? '');
    if (!query) return { removed: [] };
    const matches = entries.filter((e) => normalizeContent(e.content).includes(query));
    if (matches.length === 0) return { removed: [] };
    if (matches.length > 1) return { removed: [], ambiguous: matches };

    await writeFileEntries(path, entries.filter((e) => e.id !== matches[0].id));
    return { removed: matches };
  });
}

// ─── Prompt injection ──────────────────────────────────────────────

function renderEntries(entries: MemoryEntry[], budget: number): string[] {
  const byRecency = [...entries].sort((a, b) => b.updatedAt - a.updatedAt);
  const lines: string[] = [];
  let used = 0;
  let rendered = 0;
  for (const entry of byRecency) {
    const line = `- [${entry.id}] (${entry.kind}) ${entry.content}`;
    if (used + line.length > budget && rendered > 0) break;
    lines.push(line);
    used += line.length;
    rendered += 1;
  }
  if (rendered < entries.length) {
    lines.push(`- …and ${entries.length - rendered} more entries — use memory_list to see all.`);
  }
  return lines;
}

/**
 * Kind-based injection layering: behavior-shaping kinds are ALWAYS injected
 * (they must influence every turn); record-keeping kinds stay on disk and
 * are retrieved on demand via memory_list's query filter — so the prompt
 * footprint stays flat as recorded facts accumulate.
 */
const INJECT_KINDS: ReadonlySet<MemoryKind> = new Set(['preference', 'rule']);

function renderScopeEntries(entries: MemoryEntry[], budget: number): string[] {
  if (entries.length === 0) return ['(no saved memory yet)'];
  const injected = entries.filter((e) => INJECT_KINDS.has(e.kind));
  const onDemand = entries.length - injected.length;
  const lines = injected.length > 0 ? renderEntries(injected, budget) : [];
  if (onDemand > 0) {
    lines.push(
      `- (${onDemand} fact/decision/note entries are stored but not auto-injected — retrieve with memory_list + query when the task touches them.)`,
    );
  }
  return lines;
}

/**
 * Render the "## Memory" system-prompt section. Always rendered (even with
 * zero entries) so the agent knows the memory tools exist and when to use
 * them; injected lists are recency-ordered and char-budgeted per scope.
 */
export function formatMemoryPromptSection(
  globalEntries: MemoryEntry[],
  workspaceEntries?: MemoryEntry[],
): string {
  const lines: string[] = [
    '',
    '## Memory',
    'Long-term memory saved from earlier conversations. Treat it as background context; when it conflicts with the user\'s current instruction, the current instruction wins.',
    'Injected below: preference/rule entries (always). fact/decision/note entries are retrieval-only.',
    'Maintain it with the memory tools:',
    '- `memory_save` — when the user says 记住/remember, states a stable preference, profile fact, or standing rule, or when a hard-won decision/fix is worth keeping. Save ONE distilled statement per call; do NOT save transient task state or anything already on the canvas.',
    '- `memory_forget` — when the user asks to forget something or a saved entry is wrong or stale.',
    '- `memory_list` — when the user asks what you remember, or to RETRIEVE the non-injected fact/decision/note entries (supports a `query` substring filter).',
  ];

  lines.push('', '### Global memory (applies in every chat)');
  lines.push(...renderScopeEntries(globalEntries, PROMPT_BUDGET_PER_SCOPE));

  if (workspaceEntries) {
    lines.push('', '### Workspace memory (this workspace only)');
    lines.push(...renderScopeEntries(workspaceEntries, PROMPT_BUDGET_PER_SCOPE));
  }

  return lines.join('\n') + '\n';
}

/**
 * Load both scopes and render the prompt section for one chat turn.
 * Workspace chat passes its workspaceId (global + workspace sections);
 * global chat omits it (global section only). Never throws — memory being
 * unreadable must not break chat.
 */
export async function buildMemoryPromptSection(workspaceId?: string): Promise<string> {
  try {
    const globalEntries = await listMemory({ kind: 'global' });
    const workspaceEntries = workspaceId
      ? await listMemory({ kind: 'workspace', workspaceId })
      : undefined;
    return formatMemoryPromptSection(globalEntries, workspaceEntries);
  } catch (err) {
    console.warn('[canvas-agent] Failed to load memory for prompt injection:', err);
    return '';
  }
}
