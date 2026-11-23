/**
 * `document_read`: lets the agent read local documents that the plain `read`
 * tool rejects as binary. Office files (.docx, .pptx, .xlsx) come back as
 * Markdown; other UTF-8 files come back as text. Long results are paged by
 * character offset.
 *
 * It has the same reach as the built-in `read` tool (any file the app user
 * can read), so it is a read-tier tool. The converters load on first use to
 * keep them out of the main entry bundle.
 */

import { homedir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import { z } from 'zod';
import type { CanvasTool } from '../types';

const DOCUMENT_READ_DEFAULT_CHARS = 30_000;
const DOCUMENT_READ_MAX_CHARS = 100_000;

const resolvePath = (raw: string): string | null => {
  const trimmed = raw.trim();
  if (trimmed === '~') return homedir();
  if (trimmed.startsWith('~/')) return join(homedir(), trimmed.slice(2));
  return isAbsolute(trimmed) ? trimmed : null;
};

export function createDocumentTools(): Record<string, CanvasTool> {
  return {
    document_read: {
      name: 'document_read',
      description:
        'Read a local document as text. Converts Word (.docx), PowerPoint (.pptx), and Excel (.xlsx) '
        + 'to Markdown, and returns other UTF-8 files as-is. Use it when `read` reports a binary file. '
        + 'Long documents are paged: pass the returned next offset to continue.',
      inputSchema: z.object({
        path: z.string().min(1).describe('Absolute file path, or a path starting with ~/.'),
        offset: z.number().int().min(0).optional().describe('Character offset to start from. Defaults to 0.'),
        maxChars: z
          .number()
          .int()
          .min(1)
          .max(DOCUMENT_READ_MAX_CHARS)
          .optional()
          .describe(`Maximum characters to return. Defaults to ${DOCUMENT_READ_DEFAULT_CHARS}.`),
      }),
      execute: async (input: { path: string; offset?: number; maxChars?: number }) => {
        const filePath = resolvePath(input.path);
        if (!filePath) return `Error: path must be absolute or start with ~/: ${input.path}`;
        try {
          const { extractDocument } = await import('../../../files/documents/extract');
          const { format, content } = await extractDocument(filePath);
          const offset = Math.min(input.offset ?? 0, content.length);
          const end = Math.min(content.length, offset + (input.maxChars ?? DOCUMENT_READ_DEFAULT_CHARS));
          const range = `characters ${offset}-${end} of ${content.length}`;
          const more = end < content.length ? `; more remains, continue with offset ${end}` : '';
          return `[${filePath} · ${format} · ${range}${more}]\n\n${content.slice(offset, end)}`;
        } catch (error) {
          return `Error: ${error instanceof Error ? error.message : String(error)}`;
        }
      },
    },
  };
}
