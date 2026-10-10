import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative, sep } from 'path';

const SOURCE_ROOT = 'src';
const SHARED_ROOT = 'src/shared';

// A type exported from src/shared is the one cross-process contract. A second
// declaration with the same name elsewhere drifts silently: one side gains a
// field, the other does not, and nothing fails. Import or re-export the shared
// type instead (`export type { X } from '.../shared/...'`).
//
// Listed declarations differ from the shared type on purpose. They may only
// be removed, never added.
const INTENTIONAL_REDEFINITIONS: Record<string, string[]> = {
  // Plugin SDK: a narrow structural view, so plugins do not depend on the
  // full host contract.
  'src/plugins/types.ts': ['AgentClarificationRequest', 'AgentScope', 'AgentSessionInfo'],
  // Back-compat `workspaceId` field and stricter session rows from the store.
  'src/main/agent/types.ts': ['AgentScopeRef', 'CrossWorkspaceSessionGroup'],
  // Stored config carries `encrypted_api_key`, which never leaves main.
  'src/main/models/config.ts': ['CanvasModelProviderConfig'],
  // Agent tools read canvas JSON with a loose node type.
  'src/main/agent/tools/types.ts': ['CanvasNode', 'CanvasSaveData'],
  // On-disk schema: every field is optional until migration validates it.
  'src/main/canvas/persistence/schema.ts': ['CanvasNode', 'CanvasSaveData'],
  // The store always returns `resources`; the shared type marks it optional.
  'src/main/agent/skills/config.ts': ['CanvasSkillEntry'],
};

const TYPE_DECLARATION = /^export\s+(?:declare\s+)?(?:interface|type)\s+([A-Za-z_$][\w$]*)\b/gm;

function toRepoPath(path: string): string {
  return relative(process.cwd(), path).split(sep).join('/');
}

function isProductionSource(path: string): boolean {
  return (
    /\.tsx?$/.test(path) &&
    !path.endsWith('.d.ts') &&
    !/\.(test|spec)\.tsx?$/.test(path) &&
    !path.includes('/__tests__/')
  );
}

function walk(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      if (entry !== 'node_modules') files.push(...walk(path));
    } else if (isProductionSource(toRepoPath(path))) {
      files.push(toRepoPath(path));
    }
  }
  return files;
}

function declaredTypeNames(path: string): string[] {
  const source = readFileSync(path, 'utf8');
  return [...source.matchAll(TYPE_DECLARATION)].map((match) => match[1]);
}

function collectRedefinitions(): Record<string, string[]> {
  const files = walk(SOURCE_ROOT);
  const sharedNames = new Set(
    files
      .filter((path) => path.startsWith(`${SHARED_ROOT}/`))
      .flatMap(declaredTypeNames),
  );
  const redefinitions: Record<string, string[]> = {};
  for (const path of files) {
    if (path.startsWith(`${SHARED_ROOT}/`)) continue;
    const names = declaredTypeNames(path).filter((name) => sharedNames.has(name));
    if (names.length > 0) redefinitions[path] = [...new Set(names)].sort();
  }
  return redefinitions;
}

describe('shared contract governance', () => {
  it('declares each shared type once and re-exports it elsewhere', () => {
    const actual = collectRedefinitions();
    const expected = Object.fromEntries(
      Object.entries(INTENTIONAL_REDEFINITIONS).map(([path, names]) => [path, [...names].sort()]),
    );

    expect(actual).toEqual(expected);
  });
});
