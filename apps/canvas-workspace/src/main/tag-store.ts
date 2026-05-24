import { promises as fs } from 'fs';
import { basename, dirname, join } from 'path';
import { STORE_DIR } from './workspace-node-store';

export const TAGS_FILENAME = 'tags.json';
export const TAGS_SCHEMA_VERSION = 1;

export interface KnowledgeTagDefinition {
  id: string;
  name: string;
  description?: string;
  createdAt?: number;
  updatedAt?: number;
}

interface TagsFile {
  schemaVersion: typeof TAGS_SCHEMA_VERSION;
  tags: KnowledgeTagDefinition[];
}

export function getTagsFilePath(root: string = STORE_DIR): string {
  return join(root, TAGS_FILENAME);
}

function isEnoent(err: unknown): boolean {
  return !!err && typeof err === 'object' && (err as { code?: string }).code === 'ENOENT';
}

async function atomicWriteJson(finalPath: string, serialized: string): Promise<void> {
  const dir = dirname(finalPath);
  const tmpPath = join(dir, `${basename(finalPath)}.tmp`);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(tmpPath, serialized, 'utf-8');
  await fs.rename(tmpPath, finalPath);
}

function normalizeOptionalText(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

function assertSafeTagId(id: string): void {
  if (!id || id.length > 80 || /[\u0000-\u001f\u007f]/.test(id)) {
    throw new Error(`[tag-store] refusing unsafe tag id: ${JSON.stringify(id)}`);
  }
}

function normalizeTagDefinition(value: unknown): KnowledgeTagDefinition | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Partial<KnowledgeTagDefinition>;
  const id = normalizeOptionalText(raw.id);
  const name = normalizeOptionalText(raw.name);
  if (!id || !name) return null;
  try {
    assertSafeTagId(id);
  } catch {
    return null;
  }
  return {
    id,
    name,
    description: normalizeOptionalText(raw.description),
    createdAt: typeof raw.createdAt === 'number' ? raw.createdAt : undefined,
    updatedAt: typeof raw.updatedAt === 'number' ? raw.updatedAt : undefined,
  };
}

function normalizeTagsFile(parsed: unknown): KnowledgeTagDefinition[] {
  const rawTags = Array.isArray(parsed)
    ? parsed
    : parsed && typeof parsed === 'object' && Array.isArray((parsed as TagsFile).tags)
      ? (parsed as TagsFile).tags
      : [];
  const seen = new Set<string>();
  const tags: KnowledgeTagDefinition[] = [];
  for (const raw of rawTags) {
    const tag = normalizeTagDefinition(raw);
    if (!tag || seen.has(tag.id)) continue;
    seen.add(tag.id);
    tags.push(tag);
  }
  return tags;
}

export async function readKnowledgeTags(root: string = STORE_DIR): Promise<KnowledgeTagDefinition[]> {
  try {
    const raw = await fs.readFile(getTagsFilePath(root), 'utf-8');
    return normalizeTagsFile(JSON.parse(raw));
  } catch (err) {
    if (isEnoent(err)) return [];
    console.warn(`[tag-store] unreadable tags.json: ${String(err)}`);
    return [];
  }
}

export async function writeKnowledgeTags(
  tags: KnowledgeTagDefinition[],
  root: string = STORE_DIR,
): Promise<void> {
  const normalized = normalizeTagsFile(tags);
  const file: TagsFile = {
    schemaVersion: TAGS_SCHEMA_VERSION,
    tags: normalized,
  };
  await atomicWriteJson(getTagsFilePath(root), JSON.stringify(file, null, 2));
}

function slugifyTagName(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
}

function uniqueTagId(name: string, existingIds: Set<string>): string {
  const slug = slugifyTagName(name);
  const base = slug || `tag-${Date.now().toString(36)}`;
  let id = base;
  let suffix = 2;
  while (existingIds.has(id)) {
    id = `${base}-${suffix}`;
    suffix += 1;
  }
  return id;
}

export async function upsertKnowledgeTag(
  input: Partial<KnowledgeTagDefinition> & { name: string },
  root: string = STORE_DIR,
): Promise<KnowledgeTagDefinition> {
  const name = normalizeOptionalText(input.name);
  if (!name) throw new Error('Tag name is required.');

  const existing = await readKnowledgeTags(root);
  const existingIds = new Set(existing.map((tag) => tag.id));
  const id = normalizeOptionalText(input.id) ?? uniqueTagId(name, existingIds);
  assertSafeTagId(id);

  const now = Date.now();
  const index = existing.findIndex((tag) => tag.id === id);
  const next: KnowledgeTagDefinition = {
    id,
    name,
    description: normalizeOptionalText(input.description),
    createdAt: index >= 0 ? existing[index].createdAt : now,
    updatedAt: now,
  };

  const tags = index >= 0
    ? existing.map((tag, tagIndex) => (tagIndex === index ? next : tag))
    : [...existing, next];
  await writeKnowledgeTags(tags, root);
  return next;
}
