import { execFile } from 'child_process';
import { promises as fs } from 'fs';
import { homedir } from 'os';
import { basename, join, resolve as resolvePath } from 'path';
import { promisify } from 'util';
import { worktreeService } from './integration.js';

const MAX_PATH_LENGTH = 400;
const BRANCH_PREFIXES = ['feat', 'fix', 'docs', 'chore', 'refactor', 'test', 'hotfix'];
const DEFAULT_PROJECT_ID = 'pulse-coder';
const execFileAsync = promisify(execFile);

export interface WorktreeCreateInput {
  id: string;
  repoRoot?: string;
  worktreePath?: string;
  branch?: string;
  baseRef?: string;
  bind?: {
    runtimeKey: string;
    scopeKey: string;
  };
}

export interface WorktreeRecordView {
  id: string;
  repoRoot: string;
  worktreePath: string;
  branch?: string;
  createdAt?: number;
  updatedAt?: number;
}

export type WorktreeCreateResult =
  | { ok: true; created: boolean; worktree: WorktreeRecordView; binding?: unknown }
  | { ok: false; reason: string };

export async function listManagedWorktrees(): Promise<WorktreeRecordView[]> {
  return worktreeService.listWorktrees();
}

export async function getManagedWorktree(id: string): Promise<WorktreeRecordView | undefined> {
  const normalizedId = normalizeWorktreeId(id);
  if (!normalizedId) {
    return undefined;
  }

  return worktreeService.getWorktree(normalizedId);
}

export async function removeManagedWorktree(id: string, options: { removeDirectory?: boolean } = {}) {
  const normalizedId = normalizeWorktreeId(id);
  if (!normalizedId) {
    return { ok: false, reason: 'worktree id is required' };
  }

  const existing = await worktreeService.getWorktree(normalizedId);
  if (!existing) {
    return { ok: false, reason: `worktree not found: ${normalizedId}` };
  }

  if (options.removeDirectory) {
    try {
      await runGit(existing.repoRoot, ['worktree', 'remove', existing.worktreePath, '--force']);
    } catch (err) {
      return { ok: false, reason: `failed to remove worktree directory: ${formatError(err)}` };
    }
  }

  return worktreeService.removeWorktree(normalizedId);
}

export async function createOrRegisterWorktree(input: WorktreeCreateInput): Promise<WorktreeCreateResult> {
  const id = normalizeWorktreeId(input.id);
  if (!id) {
    return { ok: false, reason: 'id is required' };
  }

  const existing = await worktreeService.getWorktree(id);
  if (existing) {
    const binding = input.bind
      ? await worktreeService.upsertAndBind(input.bind, {
        id: existing.id,
        repoRoot: existing.repoRoot,
        worktreePath: existing.worktreePath,
        branch: existing.branch,
      })
      : undefined;

    return { ok: true, created: false, worktree: existing, binding };
  }

  const repoRoot = await resolveRepoRoot(input.repoRoot);
  if (!repoRoot) {
    return { ok: false, reason: 'unable to resolve repo root; set PULSE_CODER_REPO_ROOT or provide repoRoot' };
  }

  const branch = normalizeBranchName(input.branch) ?? resolveBranchName(id);
  const worktreePath = resolveWorktreePath({ id, repoRoot, explicitPath: input.worktreePath });
  if (repoRoot.length > MAX_PATH_LENGTH || worktreePath.length > MAX_PATH_LENGTH) {
    return { ok: false, reason: 'path is too long' };
  }

  if (await exists(worktreePath)) {
    return { ok: false, reason: `worktree path already exists: ${worktreePath}` };
  }

  try {
    await fs.mkdir(resolveWorktreeRoot(repoRoot), { recursive: true });
    await runGit(repoRoot, ['fetch', 'origin'], true);

    const branchExists = await gitRefExists(repoRoot, `refs/heads/${branch}`);
    if (branchExists) {
      await runGit(repoRoot, ['worktree', 'add', worktreePath, branch]);
    } else {
      const baseRef = input.baseRef?.trim() || await resolveBaseRef(repoRoot);
      if (!baseRef) {
        return { ok: false, reason: 'unable to find base ref (origin/main/master or main/master)' };
      }
      await runGit(repoRoot, ['worktree', 'add', worktreePath, '-b', branch, baseRef]);
    }
  } catch (err) {
    return { ok: false, reason: `failed to create worktree: ${formatError(err)}` };
  }

  const binding = input.bind
    ? await worktreeService.upsertAndBind(input.bind, { id, repoRoot, worktreePath, branch })
    : undefined;

  if (!input.bind) {
    await worktreeService.upsertWorktree({ id, repoRoot, worktreePath, branch });
  }

  const worktree = await worktreeService.getWorktree(id);
  return {
    ok: true,
    created: true,
    worktree: worktree ?? { id, repoRoot, worktreePath, branch },
    binding,
  };
}

export async function resolveRepoRoot(explicitRoot?: string): Promise<string | null> {
  const fromInput = explicitRoot?.trim();
  if (fromInput) {
    return resolvePath(fromInput);
  }

  const fromEnv = process.env.PULSE_CODER_REPO_ROOT?.trim();
  if (fromEnv) {
    return resolvePath(fromEnv);
  }

  try {
    const { stdout } = await execFileAsync('git', ['-C', process.cwd(), 'rev-parse', '--show-toplevel']);
    const root = stdout.trim();
    return root || null;
  } catch {
    return null;
  }
}

export function resolveWorktreeRoot(repoRoot: string): string {
  const fromEnv = process.env.PULSE_CODER_WORKTREE_ROOT?.trim();
  if (fromEnv) {
    return resolvePath(repoRoot, fromEnv);
  }

  return join(homedir(), '.pulse-coder', 'worktrees', resolveProjectId(repoRoot));
}

export function normalizeWorktreeId(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-+/g, '-');
}

function resolveWorktreePath(input: { id: string; repoRoot: string; explicitPath?: string }): string {
  const explicitPath = input.explicitPath?.trim();
  if (explicitPath) {
    return resolvePath(input.repoRoot, explicitPath);
  }

  return join(resolveWorktreeRoot(input.repoRoot), `wt-${input.id}`);
}

async function resolveBaseRef(repoRoot: string): Promise<string | null> {
  const candidates = ['refs/remotes/origin/main', 'refs/remotes/origin/master', 'refs/heads/main', 'refs/heads/master'];
  for (const ref of candidates) {
    if (await gitRefExists(repoRoot, ref)) {
      return ref.replace(/^refs\//, '');
    }
  }
  return null;
}

function resolveBranchName(slug: string): string {
  if (BRANCH_PREFIXES.some((prefix) => slug.startsWith(`${prefix}-`))) {
    return slug.replace(/^([a-z0-9]+)-/, '$1/');
  }
  return `feat/${slug}`;
}

function normalizeBranchName(raw?: string): string | undefined {
  const branch = raw?.trim();
  return branch || undefined;
}

function resolveProjectId(repoRoot: string): string {
  const fromEnv = process.env.PULSE_CODER_PROJECT_ID?.trim();
  if (fromEnv) {
    return normalizeWorktreeId(fromEnv) || DEFAULT_PROJECT_ID;
  }

  return normalizeWorktreeId(basename(repoRoot)) || DEFAULT_PROJECT_ID;
}

async function gitRefExists(repoRoot: string, ref: string): Promise<boolean> {
  try {
    await execFileAsync('git', ['-C', repoRoot, 'show-ref', '--verify', '--quiet', ref]);
    return true;
  } catch {
    return false;
  }
}

async function runGit(repoRoot: string, args: string[], ignoreFailure = false): Promise<string> {
  try {
    const { stdout } = await execFileAsync('git', ['-C', repoRoot, ...args]);
    return stdout.trim();
  } catch (err) {
    if (ignoreFailure) {
      return '';
    }
    throw err;
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await fs.stat(path);
    return true;
  } catch {
    return false;
  }
}

function formatError(err: unknown): string {
  if (err instanceof Error) {
    return err.message;
  }
  return String(err);
}
