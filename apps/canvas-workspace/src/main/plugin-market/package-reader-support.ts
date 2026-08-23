import { promises as fs } from 'fs';
import { isAbsolute, relative, resolve, sep } from 'path';
import type { PluginPackageDiagnostic } from '../../shared/plugin-market';

export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function diagnostic(
  severity: PluginPackageDiagnostic['severity'],
  scope: PluginPackageDiagnostic['scope'],
  code: string,
  message: string,
  path?: string,
  componentId?: string,
): PluginPackageDiagnostic {
  return {
    severity,
    scope,
    code,
    message,
    ...(path ? { path } : {}),
    ...(componentId ? { componentId } : {}),
  };
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function isContained(root: string, target: string): boolean {
  const child = relative(root, target);
  return child === ''
    || (child !== '..' && !child.startsWith(`..${sep}`) && !isAbsolute(child));
}

export async function containedRealpath(root: string, path: string): Promise<string> {
  const canonical = await fs.realpath(path);
  if (!isContained(root, canonical)) {
    throw new Error(`Path resolves outside plugin root: ${path}`);
  }
  return canonical;
}

export function isAbsolutePackagePath(path: string): boolean {
  return isAbsolute(path) || /^[a-zA-Z]:/.test(path) || path.startsWith('\\\\');
}

export async function resolvePackagePath(
  root: string,
  configuredPath: string,
  kind: 'file' | 'directory',
): Promise<string> {
  if (isAbsolutePackagePath(configuredPath)) {
    throw new Error(`Absolute package path is not allowed: ${configuredPath}`);
  }
  const candidate = resolve(root, configuredPath);
  if (!isContained(root, candidate)) throw new Error(`Path escapes plugin root: ${configuredPath}`);
  const canonical = await containedRealpath(root, candidate);
  const stat = await fs.stat(canonical);
  if (kind === 'file' ? !stat.isFile() : !stat.isDirectory()) {
    throw new Error(`${configuredPath} is not a ${kind}`);
  }
  return canonical;
}

export async function readJson(path: string): Promise<unknown> {
  return JSON.parse(await fs.readFile(path, 'utf8')) as unknown;
}

export async function pathExists(path: string): Promise<boolean> {
  try {
    await fs.lstat(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}

export function stringArray(value: unknown): string[] | null {
  return Array.isArray(value) && value.every((item) => typeof item === 'string')
    ? value
    : null;
}

export function stringRecord(value: unknown): Record<string, string> | null {
  if (!isRecord(value)) return null;
  const entries = Object.entries(value);
  return entries.every(([, item]) => typeof item === 'string')
    ? Object.fromEntries(entries) as Record<string, string>
    : null;
}
