import { promises as fs } from 'fs';
import { createHash, randomUUID } from 'crypto';
import { basename, dirname, isAbsolute, join, win32 } from 'path';

/** Read only our canonical wrapper; never execute shell text to discover a host. */
export async function readLauncherHost(cliPath: string, platform: NodeJS.Platform): Promise<string | null> {
  try {
    const content = await fs.readFile(cliPath, 'utf8');
    const match = platform === 'win32'
      ? content.match(/^@echo off\r\nset "ELECTRON_RUN_AS_NODE=1"\r\n"([^"]+)" "([^"]+)" %\*\r\n$/)
      : content.match(/^#!\/bin\/sh\nELECTRON_RUN_AS_NODE=1 exec '((?:[^']|'"'"')*)' '((?:[^']|'"'"')*)' "\$@"\n$/);
    if (!match) return null;
    const host = match[1].split(`'"'"'`).join("'");
    const entry = match[2].split(`'"'"'`).join("'");
    const expected = platform === 'win32' ? windowsWrapper(host, entry) : unixWrapper(host, entry);
    if (!(platform === 'win32' ? win32.isAbsolute(host) : isAbsolute(host)) || content !== expected) return null;
    const stat = await fs.stat(host);
    return stat.isFile() && (platform === 'win32' || (stat.mode & 0o111) !== 0) ? host : null;
  } catch {
    return null;
  }
}

export const BUNDLE_MARKER = '.pulse-canvas-bundle.json';

export function decorateSkillContent(
  content: string,
  cliPath: string,
  platform: NodeJS.Platform,
): string {
  const invocation = platform === 'win32'
    ? `& "${cliPath.split('"').join('`"')}"`
    : shellQuote(cliPath);
  const instruction =
    `\n> Managed by Pulse Canvas. Invoke the bundled CLI as \`${invocation}\`; `
    + 'do not assume `pulse-canvas` is on PATH.\n';
  const withInstruction = content.replace(
    /^(---\n[\s\S]*?\n---\n)/,
    `$1${instruction}`,
  );
  return withInstruction
    .replace(/(^|\n)pulse-canvas(?=\s)/g, `$1${invocation}`)
    .replace(/`pulse-canvas(?=\s)/g, `\`${invocation}`);
}

export async function isLauncherCurrent(
  cliPath: string,
  expectedContent: string,
  platform: NodeJS.Platform,
): Promise<boolean> {
  try {
    const [content, stat] = await Promise.all([
      fs.readFile(cliPath, 'utf8'),
      fs.stat(cliPath),
    ]);
    return content === expectedContent
      && (platform === 'win32' || (stat.mode & 0o111) !== 0);
  } catch {
    return false;
  }
}

export async function isBundleCurrent(
  versionDir: string,
  fingerprint: string,
): Promise<boolean> {
  try {
    const marker = JSON.parse(
      await fs.readFile(join(versionDir, BUNDLE_MARKER), 'utf8'),
    ) as { fingerprint?: unknown };
    return marker.fingerprint === fingerprint
      && await fingerprintCliTree(versionDir) === fingerprint;
  } catch {
    return false;
  }
}

export async function fingerprintCliTree(cliDir: string): Promise<string> {
  const hash = createHash('sha256');
  hash.update(await fs.readFile(join(cliDir, 'index.cjs')));
  const skillsDir = join(cliDir, 'skills');
  const entries = (await fs.readdir(skillsDir, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .sort((left, right) => left.name.localeCompare(right.name));
  for (const entry of entries) {
    const skillPath = join(skillsDir, entry.name, 'SKILL.md');
    try {
      const content = await fs.readFile(skillPath);
      hash.update(entry.name);
      hash.update(content);
    } catch {
      // Match bundle discovery: support directories without SKILL.md are ignored.
    }
  }
  const nativeDir = join(cliDir, 'native');
  async function hashNativeFiles(directory: string, prefix = 'native'): Promise<void> {
    const files = (await fs.readdir(directory, { withFileTypes: true }))
      .sort((left, right) => left.name.localeCompare(right.name));
    for (const file of files) {
      const relative = `${prefix}/${file.name}`;
      if (file.isDirectory()) {
        await hashNativeFiles(join(directory, file.name), relative);
      } else if (file.isFile()) {
        hash.update(`${relative}\0`);
        hash.update(await fs.readFile(join(directory, file.name)));
      } else {
        throw new Error(`Unsupported native payload entry: ${relative}`);
      }
    }
  }
  try {
    await fs.access(nativeDir);
  } catch (error: any) {
    // Keep validating pinned bundles produced before the native payload existed.
    if (error?.code === 'ENOENT') return hash.digest('hex');
    throw error;
  }
  await hashNativeFiles(nativeDir);
  return hash.digest('hex');
}

export async function allExist(paths: string[]): Promise<boolean> {
  try {
    await Promise.all(paths.map((path) => fs.access(path)));
    return true;
  } catch {
    return false;
  }
}

export async function atomicWrite(path: string, content: string, mode?: number): Promise<void> {
  await fs.mkdir(dirname(path), { recursive: true });
  const temporary = join(dirname(path), `.${basename(path)}.${process.pid}.${randomUUID()}`);
  try {
    await fs.writeFile(temporary, content, { encoding: 'utf8', ...(mode ? { mode } : {}) });
    try {
      await fs.rename(temporary, path);
    } catch (error: any) {
      if (error?.code !== 'EEXIST' && error?.code !== 'EPERM' && error?.code !== 'ENOTEMPTY') {
        throw error;
      }
      await fs.rm(path, { force: true });
      await fs.rename(temporary, path);
    }
    if (mode) await fs.chmod(path, mode);
  } finally {
    await fs.rm(temporary, { force: true });
  }
}

export function unixWrapper(hostExecutable: string, entryPath: string): string {
  return '#!/bin/sh\n'
    + `ELECTRON_RUN_AS_NODE=1 exec ${shellQuote(hostExecutable)} ${shellQuote(entryPath)} "$@"\n`;
}

export function windowsWrapper(hostExecutable: string, entryPath: string): string {
  return '@echo off\r\n'
    + 'set "ELECTRON_RUN_AS_NODE=1"\r\n'
    + `"${hostExecutable.split('"').join('""')}" "${entryPath.split('"').join('""')}" %*\r\n`;
}

function shellQuote(value: string): string {
  return `'${value.split("'").join(`'"'"'`)}'`;
}
