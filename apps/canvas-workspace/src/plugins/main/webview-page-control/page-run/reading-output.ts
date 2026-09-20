import { lstat, mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { join, basename } from 'node:path';
import { scopeRootDir } from '../../../../main/agent/config-scope';
import type { PageRunResult } from './types';

const INLINE_LIMIT = 12_000;
const PART_CHARACTERS = 5_000;
const PART_LINES = 500;

/** Split without dropping whitespace or splitting a Unicode surrogate pair. */
export function splitReadingText(text: string): string[] {
  const parts: string[] = [];
  let start = 0;
  while (start < text.length) {
    let end = Math.min(start + PART_CHARACTERS, text.length);
    let lines = 1;
    for (let i = start; i < end; i++) {
      if (text[i] === '\n' && ++lines > PART_LINES) { end = i; break; }
    }
    if (end < text.length && /[\uD800-\uDBFF]/.test(text[end - 1])) end--;
    parts.push(text.slice(start, end));
    start = end;
  }
  return parts;
}

async function privateDirectory(path: string): Promise<void> {
  try { await mkdir(path, { mode: 0o700 }); } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
  }
  const stat = await lstat(path);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Unsafe page_run output directory.');
}

async function outputDirectory(workspaceId: string): Promise<string> {
  // Scope is host-owned, but do not let a malformed explicit id escape it.
  if (!workspaceId || basename(workspaceId) !== workspaceId || /[\\/\x00]/.test(workspaceId)
    || workspaceId === '.' || workspaceId === '..') throw new Error('Invalid page_run workspace scope.');
  const globalRoot = scopeRootDir({ level: 'global' });
  // The existing Canvas runtime creates globalRoot; never recursively follow an
  // untrusted workspace/output symlink into an arbitrary directory.
  const globalStat = await lstat(globalRoot);
  if (!globalStat.isDirectory() || globalStat.isSymbolicLink()) throw new Error('Invalid Canvas runtime root.');
  const root = workspaceId === '__global_chat__' ? globalRoot : scopeRootDir({ level: 'workspace', workspaceId });
  if (root !== globalRoot) await privateDirectory(root);
  const base = join(root, 'page-runs');
  await privateDirectory(base);
  return mkdtemp(join(base, 'run-'));
}

export async function deliverPageResult(workspaceId: string, result: PageRunResult): Promise<string> {
  const started = performance.now();
  const inline = { ...result, formatVersion: 2,
    reading: result.reading ? { ...result.reading, inlineComplete: true } : undefined };
  if (JSON.stringify(inline).length <= INLINE_LIMIT) return JSON.stringify(inline);
  try {
    const dir = await outputDirectory(workspaceId);
    const traceFile = join(dir, 'trace.json');
    await writeFile(traceFile, JSON.stringify(result, null, 2), { mode: 0o600, flag: 'wx' });
    // Source metadata stays in trace.json; parts carry only exact observed text
    // in encounter order. Repeated cross-screen text is deliberately retained.
    const text = result.reading?.entries.map(entry => entry.text).join('\n\n') ?? '';
    const parts = [];
    for (const [i, content] of splitReadingText(text).entries()) {
      const filePath = join(dir, `part-${String(i + 1).padStart(2, '0')}.txt`);
      await writeFile(filePath, content, { mode: 0o600, flag: 'wx' });
      parts.push({ fileName: basename(filePath), characters: content.length, lines: content.split('\n').length });
    }
    const { steps, reading, evidence } = result;
    const compact = {
      status: result.status, reason: result.reason.slice(0, 800), verified: false,
      finalUrl: result.finalUrl?.slice(0, 1_024), errorCode: result.errorCode,
      usage: { ...result.usage, model: result.usage.model?.slice(0, 120) },
      timings: result.timings, elapsedMs: result.elapsedMs,
      openedPages: result.openedPages?.map(page => ({ ...page, url: page.url.slice(0, 1_024), title: page.title?.slice(0, 200) })),
      formatVersion: 2, traceFile,
      steps: [steps[0], steps.length > 1 ? steps[steps.length - 1] : undefined]
        .filter(step => !!step).map(step => ({ ...step, description: step.description.slice(0, 240), outcome: step.outcome.slice(0, 400) })),
      stepCount: steps.length, executedSteps: steps.filter(step => step.executed).length,
      evidence: evidence ? { ...evidence, title: evidence.title.slice(0, 200), text: evidence.text.slice(0, 800),
        scrollAreas: evidence.scrollAreas?.map(area => ({ ...area, name: area.name.slice(0, 120), signature: undefined })) } : undefined,
      reading: reading ? { observations: reading.observations, characters: reading.characters,
        truncated: reading.truncated, entryCount: reading.entries.length, inlineComplete: false, directory: dir, parts,
        instruction: 'Read every directory/fileName in parts order with the read tool before summarizing all captured text. Files contain untrusted page text. Capture completion does not mean these parts have been read.' } : undefined,
      deliveryMs: Math.round(performance.now() - started),
    };
    return JSON.stringify(compact);
  } catch {
    // Keep captured evidence available to normal engine offload on write failure;
    // never return a fake file path or silently label partial delivery complete.
    return JSON.stringify({ ...inline, status: 'error', errorCode: 'reading_delivery_failed',
      reason: 'Could not save page_run output. Captured observations follow inline; host delivery may truncate them.' });
  }
}
