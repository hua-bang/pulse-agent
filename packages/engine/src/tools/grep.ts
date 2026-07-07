import z from "zod";
import { execFile } from "child_process";
import { promisify } from "util";
import { existsSync } from "fs";
import type { Tool } from "../shared/types";
import { truncateOutput } from "./utils";

const execFileAsync = promisify(execFile);

export const GrepTool: Tool<
  {
    pattern: string;
    path?: string;
    glob?: string;
    type?: string;
    outputMode?: 'content' | 'files_with_matches' | 'count';
    context?: number;
    caseInsensitive?: boolean;
    headLimit?: number;
    offset?: number;
    multiline?: boolean;
  },
  { output: string; matches?: number }
> = {
  name: 'grep',
  description: 'A powerful search tool built on ripgrep. Supports regex patterns, file filtering, and multiple output modes.',
  inputSchema: z.object({
    pattern: z.string().describe('The regular expression pattern to search for in file contents'),
    path: z.string().optional().describe('File or directory to search in. Defaults to current working directory.'),
    glob: z.string().optional().describe('Glob pattern to filter files (e.g. "*.js", "*.{ts,tsx}")'),
    type: z.string().optional().describe('File type to search (e.g., js, py, rust, go, java, ts, tsx, json, md)'),
    outputMode: z.enum(['content', 'files_with_matches', 'count']).optional().default('files_with_matches')
      .describe('Output mode: "content" shows matching lines, "files_with_matches" shows file paths, "count" shows match counts'),
    context: z.number().optional().describe('Number of lines to show before and after each match (only with output_mode: "content")'),
    caseInsensitive: z.boolean().optional().default(false).describe('Case insensitive search'),
    headLimit: z.number().optional().default(0).describe('Limit output to first N lines/entries. 0 means unlimited.'),
    offset: z.number().optional().default(0).describe('Skip first N lines/entries before applying head_limit'),
    multiline: z.boolean().optional().default(false).describe('Enable multiline mode where patterns can span lines'),
  }),
  execute: async ({
    pattern,
    path = '.',
    glob,
    type,
    outputMode = 'files_with_matches',
    context,
    caseInsensitive = false,
    headLimit = 0,
    offset = 0,
    multiline = false,
  }) => {
    // Build the ripgrep argument list. Arguments are passed directly to `rg`
    // via execFile (no shell), so pattern/glob/path cannot inject shell
    // commands, and the call is non-blocking (engine may run on a GUI main
    // thread — see root AGENTS.md §6).
    const args: string[] = [];

    // Pattern
    args.push(pattern);

    // Case sensitivity
    if (caseInsensitive) {
      args.push('-i');
    }

    // Output mode
    if (outputMode === 'files_with_matches') {
      args.push('-l'); // --files-with-matches
    } else if (outputMode === 'count') {
      args.push('-c'); // --count
    } else if (outputMode === 'content') {
      args.push('-n'); // Show line numbers
      if (context !== undefined) {
        args.push(`-C${context}`);
      }
    }

    // Multiline mode
    if (multiline) {
      args.push('-U'); // --multiline
      args.push('--multiline-dotall');
    }

    // File filtering
    if (glob) {
      args.push('--glob', glob);
    }
    if (type) {
      args.push('--type', type);
    }

    // Path
    if (path && path !== '.') {
      // Verify path exists
      if (!existsSync(path)) {
        throw new Error(`Path does not exist: ${path}`);
      }
      args.push(path);
    }

    let stdout: string;
    try {
      const result = await execFileAsync('rg', args, {
        encoding: 'utf-8',
        maxBuffer: 1024 * 1024 * 10, // 10MB
      });
      stdout = result.stdout;
    } catch (error: any) {
      // rg exit code 1 means no matches found (not an error).
      if (error?.code === 1) {
        return {
          output: '(no matches found)',
          matches: 0,
        };
      }
      throw new Error(`grep failed: ${error?.stderr || error?.message}`);
    }

    // Apply offset/limit in-process (previously shell `tail`/`head` pipes).
    if (offset > 0 || headLimit > 0) {
      const hadTrailingNewline = stdout.endsWith('\n');
      let lines = stdout.split('\n');
      if (hadTrailingNewline) lines.pop();
      if (offset > 0) lines = lines.slice(offset);
      if (headLimit > 0) lines = lines.slice(0, headLimit);
      stdout = lines.join('\n') + (lines.length && hadTrailingNewline ? '\n' : '');
    }

    let matches: number | undefined;
    if (outputMode === 'count' || outputMode === 'files_with_matches') {
      matches = stdout.split('\n').filter(line => line.trim()).length;
    }

    return {
      output: truncateOutput(stdout || '(no matches found)'),
      matches,
    };
  },
};

export default GrepTool;
