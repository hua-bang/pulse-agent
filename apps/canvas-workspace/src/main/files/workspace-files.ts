import { mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { createLocalWorkspaceFiles } from '@pulse-coder/storage/local-workspace-files';

/**
 * Markdown and attachment content in Canvas main goes through this repository
 * (URI + content version). Only explicit real-path consumers, such as terminal
 * agents and `AGENTS.md`, use `workspaceFiles.localPath` or direct paths.
 */
export const workspaceFiles = createLocalWorkspaceFiles();

/** A local file's text, or `null` when it does not exist. */
export async function readWorkspaceText(path: string): Promise<string | null> {
  const file = await workspaceFiles.readText(workspaceFiles.uriForPath(resolve(path)));
  return file ? file.content : null;
}

/** Create or replace a note's content, creating its folder when needed. */
export async function writeWorkspaceText(path: string, content: string): Promise<string> {
  await mkdir(dirname(resolve(path)), { recursive: true });
  return (await workspaceFiles.write(workspaceFiles.uriForPath(resolve(path)), content)).version;
}
