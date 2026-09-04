import { homedir } from 'os';
import { statSync } from 'fs';

export function isExistingDirectory(value: string): boolean {
  try {
    return statSync(value).isDirectory();
  } catch {
    return false;
  }
}

const expandHomePath = (value: string): string =>
  value === '~' || value.startsWith('~/')
    ? value.replace(/^~/, homedir())
    : value;

const trimPathToken = (value: string): string =>
  value.replace(/[),.;:!?，。；：、]+$/u, '');

export function inferWorkingDirectoryFromText(content: string): string | undefined {
  const matches = content.matchAll(/(?:^|[\s([{"'`])(?<path>~?\/[^\s)\]}"'`，。；：、]+)/gu);
  const candidates = Array.from(matches)
    .map((match) => trimPathToken(match.groups?.path ?? ''))
    .filter((candidate) => candidate.length > 1)
    .map(expandHomePath)
    .sort((a, b) => b.length - a.length);
  return candidates.find(isExistingDirectory);
}
