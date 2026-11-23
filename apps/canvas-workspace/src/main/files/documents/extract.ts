import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import { extname } from 'node:path';
import { docxToMarkdown } from './docx';
import { pptxToMarkdown } from './pptx';
import { xlsxToMarkdown } from './xlsx';

/**
 * Turns a local file into text an agent can read. Office documents become
 * Markdown; any other UTF-8 file is returned as it is. Binary formats without
 * a converter (PDF, legacy .doc/.xls/.ppt, images, archives) are rejected
 * with a message that names the supported formats.
 */

export type DocumentFormat = 'docx' | 'pptx' | 'xlsx' | 'text';

export interface ExtractedDocument {
  format: DocumentFormat;
  content: string;
}

/** Office files are zip archives that are much larger than their text. */
const DOCUMENT_MAX_BYTES = 50 * 1024 * 1024;

const CONVERTERS: Record<string, { format: DocumentFormat; convert: (bytes: Uint8Array) => string }> = {
  '.docx': { format: 'docx', convert: docxToMarkdown },
  '.docm': { format: 'docx', convert: docxToMarkdown },
  '.pptx': { format: 'pptx', convert: pptxToMarkdown },
  '.pptm': { format: 'pptx', convert: pptxToMarkdown },
  '.xlsx': { format: 'xlsx', convert: xlsxToMarkdown },
  '.xlsm': { format: 'xlsx', convert: xlsxToMarkdown },
};

const UNSUPPORTED_MESSAGE =
  'Supported: Word (.docx), PowerPoint (.pptx), Excel (.xlsx), and UTF-8 text files. '
  + 'PDF and legacy .doc/.xls/.ppt files are not supported yet.';

const readBytes = async (filePath: string): Promise<Uint8Array> => {
  // Nonblocking open keeps a FIFO path from hanging the main process.
  const file = await open(filePath, constants.O_RDONLY | constants.O_NONBLOCK);
  try {
    const stat = await file.stat();
    if (!stat.isFile()) throw new Error(`Not a regular file: ${filePath}`);
    if (stat.size > DOCUMENT_MAX_BYTES) {
      throw new Error(`File is too large to read (${stat.size} bytes, limit ${DOCUMENT_MAX_BYTES}).`);
    }
    return await file.readFile();
  } finally {
    await file.close();
  }
};

const decodeText = (bytes: Uint8Array): string | null => {
  if (bytes.includes(0)) return null;
  try {
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(bytes);
  } catch {
    return null;
  }
};

export const extractDocument = async (filePath: string): Promise<ExtractedDocument> => {
  const bytes = await readBytes(filePath);
  const converter = CONVERTERS[extname(filePath).toLowerCase()];
  if (converter) {
    try {
      return { format: converter.format, content: converter.convert(bytes) };
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      throw new Error(`Could not read ${filePath} as ${converter.format}: ${reason}`);
    }
  }
  const text = decodeText(bytes);
  if (text === null) throw new Error(`Cannot read binary file: ${filePath}. ${UNSUPPORTED_MESSAGE}`);
  return { format: 'text', content: text };
};
