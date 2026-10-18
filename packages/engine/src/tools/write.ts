import z from "zod";
import { access, mkdir, writeFile } from "fs/promises";
import { dirname } from "path";
import type { Tool } from "../shared/types";
import { withFileLock } from "./utils";

export const WriteTool: Tool<
  { filePath: string; content: string },
  { success: boolean; created: boolean; bytes: number }
> = {
  name: 'write',
  description: 'Write contents to a file. Automatically creates parent directories if they do not exist. Will overwrite existing files.',
  inputSchema: z.object({
    filePath: z.string().describe('The absolute path to the file to write (must be absolute, not relative)'),
    content: z.string().describe('The content to write to the file'),
  }),
  // Shares the edit lock, so a write never lands between an edit's read and write.
  execute: ({ filePath, content }) => withFileLock(filePath, async () => {
    // Check if file already exists
    const fileExists = await access(filePath).then(() => true, () => false);

    // Create parent directories if they don't exist (no-op when present)
    await mkdir(dirname(filePath), { recursive: true });

    // Write the file
    await writeFile(filePath, content, 'utf-8');

    // Calculate bytes written
    const bytes = Buffer.byteLength(content, 'utf-8');

    return {
      success: true,
      created: !fileExists,
      bytes,
    };
  }),
};

export default WriteTool;
