import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  buildMemoryPromptSection,
  forgetMemory,
  formatMemoryPromptSection,
  listMemory,
  memoryFilePath,
  saveMemory,
  MEMORY_MAX_CONTENT_CHARS,
  type MemoryEntry,
} from '../memory-store';
import { createMemoryTools } from '../tools/memory';

const GLOBAL = { kind: 'global' } as const;
const WS = { kind: 'workspace', workspaceId: 'ws-1' } as const;

describe('memory-store', () => {
  let root: string;

  beforeEach(() => {
    root = join(tmpdir(), `memory-store-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    process.env.PULSE_CANVAS_MEMORY_DIR = root;
  });

  afterEach(async () => {
    delete process.env.PULSE_CANVAS_MEMORY_DIR;
    await fs.rm(root, { recursive: true, force: true });
  });

  it('saves and lists per scope without cross-contamination', async () => {
    await saveMemory(GLOBAL, 'User prefers Chinese replies', 'preference');
    await saveMemory(WS, 'This project uses pnpm', 'rule');

    const globalEntries = await listMemory(GLOBAL);
    const wsEntries = await listMemory(WS);
    expect(globalEntries.map((e) => e.content)).toEqual(['User prefers Chinese replies']);
    expect(wsEntries.map((e) => e.content)).toEqual(['This project uses pnpm']);
    expect(await listMemory({ kind: 'workspace', workspaceId: 'ws-other' })).toEqual([]);
  });

  it('dedupes normalized-equal content into an update instead of appending', async () => {
    const first = await saveMemory(GLOBAL, 'User prefers  Chinese replies');
    const second = await saveMemory(GLOBAL, 'user prefers chinese REPLIES', 'preference');

    expect(second.updated).toBe(true);
    expect(second.entry.id).toBe(first.entry.id);
    const entries = await listMemory(GLOBAL);
    expect(entries).toHaveLength(1);
    expect(entries[0].kind).toBe('preference');
  });

  it('rejects empty and oversized content', async () => {
    await expect(saveMemory(GLOBAL, '   ')).rejects.toThrow(/empty/i);
    await expect(saveMemory(GLOBAL, 'x'.repeat(MEMORY_MAX_CONTENT_CHARS + 1))).rejects.toThrow(/max/i);
  });

  it('sanitizes hostile workspace ids out of the file path', () => {
    const path = memoryFilePath({ kind: 'workspace', workspaceId: '../../etc/passwd' });
    expect(path.startsWith(join(root, 'workspaces'))).toBe(true);
    expect(path).not.toContain('..');
  });

  it('forgets by id, and by query only when unambiguous', async () => {
    const a = await saveMemory(WS, 'Use tabs for indentation');
    await saveMemory(WS, 'Use pnpm for installs');

    const ambiguous = await forgetMemory(WS, { query: 'use' });
    expect(ambiguous.removed).toEqual([]);
    expect(ambiguous.ambiguous).toHaveLength(2);
    expect(await listMemory(WS)).toHaveLength(2);

    const byQuery = await forgetMemory(WS, { query: 'pnpm' });
    expect(byQuery.removed.map((e) => e.content)).toEqual(['Use pnpm for installs']);

    const byId = await forgetMemory(WS, { id: a.entry.id });
    expect(byId.removed.map((e) => e.id)).toEqual([a.entry.id]);
    expect(await listMemory(WS)).toEqual([]);
  });

  it('survives concurrent saves to the same scope without losing entries', async () => {
    await Promise.all(
      Array.from({ length: 20 }, (_, i) => saveMemory(GLOBAL, `entry number ${i}`)),
    );
    const entries = await listMemory(GLOBAL);
    expect(entries).toHaveLength(20);
    const files = await fs.readdir(root);
    expect(files.filter((name) => name.includes('.tmp'))).toEqual([]);
  });

  it('recovers from a corrupt memory file by treating it as empty', async () => {
    const path = memoryFilePath(GLOBAL);
    await fs.mkdir(root, { recursive: true });
    await fs.writeFile(path, 'not json{{{', 'utf-8');
    expect(await listMemory(GLOBAL)).toEqual([]);
    await saveMemory(GLOBAL, 'fresh start');
    expect((await listMemory(GLOBAL)).map((e) => e.content)).toEqual(['fresh start']);
  });

  describe('prompt section', () => {
    const entry = (id: string, content: string, updatedAt: number): MemoryEntry => ({
      id,
      content,
      kind: 'note',
      createdAt: updatedAt,
      updatedAt,
    });

    it('renders both scopes recency-first with guidance always present', () => {
      const section = formatMemoryPromptSection(
        [entry('mem-1', 'older global', 1), entry('mem-2', 'newer global', 2)],
        [entry('mem-3', 'workspace fact', 3)],
      );
      expect(section).toContain('## Memory');
      expect(section).toContain('memory_save');
      expect(section.indexOf('newer global')).toBeLessThan(section.indexOf('older global'));
      expect(section).toContain('### Workspace memory');
      expect(section).toContain('workspace fact');
    });

    it('omits the workspace section in global chat and notes overflow', () => {
      const many = Array.from({ length: 60 }, (_, i) =>
        entry(`mem-${i}`, `long enough content to consume prompt budget ${'x'.repeat(120)} ${i}`, i),
      );
      const section = formatMemoryPromptSection(many);
      expect(section).not.toContain('### Workspace memory');
      expect(section).toContain('more entries — use memory_list');
    });

    it('buildMemoryPromptSection loads from disk per scope', async () => {
      await saveMemory(GLOBAL, 'global pref');
      await saveMemory(WS, 'ws decision');
      const wsSection = await buildMemoryPromptSection('ws-1');
      expect(wsSection).toContain('global pref');
      expect(wsSection).toContain('ws decision');
      const globalSection = await buildMemoryPromptSection();
      expect(globalSection).toContain('global pref');
      expect(globalSection).not.toContain('### Workspace memory');
    });
  });
});

describe('memory tools', () => {
  let root: string;

  beforeEach(() => {
    root = join(tmpdir(), `memory-tools-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    process.env.PULSE_CANVAS_MEMORY_DIR = root;
  });

  afterEach(async () => {
    delete process.env.PULSE_CANVAS_MEMORY_DIR;
    await fs.rm(root, { recursive: true, force: true });
  });

  it('workspace chat saves to workspace by default and to global on request', async () => {
    const tools = createMemoryTools('ws-1');

    const wsResult = JSON.parse(await tools.memory_save.execute({ content: 'project uses vitest' }));
    expect(wsResult.ok).toBe(true);
    expect(wsResult.entry.scope).toBe('workspace');

    const globalResult = JSON.parse(
      await tools.memory_save.execute({ content: 'reply in Chinese', scope: 'global', kind: 'preference' }),
    );
    expect(globalResult.entry.scope).toBe('global');

    const listed = JSON.parse(await tools.memory_list.execute({}));
    expect(listed.total).toBe(2);
    expect(listed.workspace.map((e: { content: string }) => e.content)).toEqual(['project uses vitest']);
    expect(listed.global.map((e: { content: string }) => e.content)).toEqual(['reply in Chinese']);
  });

  it('global chat forces global scope and cannot touch workspace memory', async () => {
    await saveMemory(WS, 'workspace-only secret');
    const tools = createMemoryTools('');

    const saved = JSON.parse(await tools.memory_save.execute({ content: 'from global chat' }));
    expect(saved.entry.scope).toBe('global');

    const listed = JSON.parse(await tools.memory_list.execute({}));
    expect(listed.workspace).toBeUndefined();
    expect(listed.global.map((e: { content: string }) => e.content)).toEqual(['from global chat']);

    const forgotten = JSON.parse(await tools.memory_forget.execute({ query: 'workspace-only' }));
    expect(forgotten.ok).toBe(false);
    expect((await listMemory(WS)).map((e) => e.content)).toEqual(['workspace-only secret']);
  });

  it('memory_forget searches workspace first then global, and surfaces ambiguity', async () => {
    const tools = createMemoryTools('ws-1');
    await tools.memory_save.execute({ content: 'shared token in workspace' });
    await tools.memory_save.execute({ content: 'shared token in global', scope: 'global' });

    const ambiguous = JSON.parse(await tools.memory_forget.execute({ query: 'nothing matches this' }));
    expect(ambiguous.ok).toBe(false);

    const removed = JSON.parse(await tools.memory_forget.execute({ query: 'shared token' }));
    expect(removed.ok).toBe(true);
    expect(removed.removed[0].scope).toBe('workspace');
    expect((await listMemory(GLOBAL)).map((e) => e.content)).toEqual(['shared token in global']);

    const removedGlobal = JSON.parse(await tools.memory_forget.execute({ query: 'shared token' }));
    expect(removedGlobal.removed[0].scope).toBe('global');
  });

  it('surfaces store errors as tool results instead of throwing', async () => {
    const tools = createMemoryTools('ws-1');
    const result = JSON.parse(
      await tools.memory_save.execute({ content: 'x'.repeat(MEMORY_MAX_CONTENT_CHARS + 1) }),
    );
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/max/i);
  });
});
