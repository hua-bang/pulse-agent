import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  getTagsFilePath,
  readKnowledgeTags,
  upsertKnowledgeTag,
  writeKnowledgeTags,
} from '../tag-store';

let root: string;

beforeEach(async () => {
  root = join(
    tmpdir(),
    `tag-store-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  );
  await fs.mkdir(root, { recursive: true });
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

describe('tag-store', () => {
  it('stores global tag definitions in tags.json', async () => {
    await writeKnowledgeTags([
      { id: 'ai', name: 'AI', description: 'Artificial intelligence' },
      { id: 'rag', name: 'RAG' },
    ], root);

    const raw = JSON.parse(await fs.readFile(getTagsFilePath(root), 'utf-8')) as {
      schemaVersion: number;
      tags: unknown[];
    };
    expect(raw.schemaVersion).toBe(1);
    expect(raw.tags).toHaveLength(2);
    await expect(readKnowledgeTags(root)).resolves.toEqual([
      { id: 'ai', name: 'AI', description: 'Artificial intelligence' },
      { id: 'rag', name: 'RAG' },
    ]);
  });

  it('upserts by stable id and can generate an id from name', async () => {
    const created = await upsertKnowledgeTag({ name: 'Context Engineering' }, root);
    expect(created.id).toBe('context-engineering');

    const updated = await upsertKnowledgeTag({
      id: created.id,
      name: 'Context Engineering',
      description: 'Prompt and state design',
    }, root);
    expect(updated.id).toBe(created.id);
    expect(updated.createdAt).toBe(created.createdAt);
    expect(updated.description).toBe('Prompt and state design');
    await expect(readKnowledgeTags(root)).resolves.toHaveLength(1);
  });
});
