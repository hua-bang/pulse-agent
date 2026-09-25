import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const MAIN = join(process.cwd(), 'src', 'main');

/**
 * Markdown and attachment content in Canvas main goes through the
 * WorkspaceFiles repository (one content-version scheme, compare-and-swap
 * writes). These modules own that content; direct fs content I/O here would
 * bypass the version checks. Real-path consumers (AGENTS.md, terminal agents,
 * save-dialog exports, import staging) are intentionally not listed.
 */
const ROUTED_MODULES = [
  'files/file-save.ts',
  'files/image-save.ts',
  'canvas/sync/markdown-index.ts',
  'canvas/node-operations.ts',
  'canvas/workspace-export-external-files.ts',
  'agent/tools/_shared/image-io.ts',
];

const DIRECT_CONTENT_IO = /\b(?:readFile|writeFile|appendFile|copyFile|unlink|rename)\s*\(|\bwatch\s*\(\s*(?!workspaceFiles)/;

describe('WorkspaceFiles routing', () => {
  it.each(ROUTED_MODULES)('%s reads and writes content through the repository', (relativePath) => {
    const source = readFileSync(join(MAIN, relativePath), 'utf8');
    expect(source).toMatch(/workspaceFiles\.|(?:read|write)WorkspaceText\(/);
    expect(source).not.toMatch(DIRECT_CONTENT_IO);
  });
});
