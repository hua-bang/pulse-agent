/**
 * Workspace-config store — owns the global + per-workspace `mcp.json` and
 * `skills.json` files that drive the canvas-agent Engine's MCP + skills
 * tool set.
 *
 * Layout (all under `~/.pulse-coder/canvas/`):
 *   global/mcp.json       — applies to every workspace
 *   global/skills.json
 *   <workspaceId>/mcp.json    — overrides global for this workspace
 *   <workspaceId>/skills.json
 *
 * Merge rules: workspace wins on name collision (full replacement of the
 * server / skill entry — we don't deep-merge env/args because that would
 * be surprising). Returns a snapshot plus a `configHash` so callers can
 * cheaply tell whether anything has changed since their last read.
 */

import { promises as fs } from 'fs';
import { createHash } from 'crypto';
import { homedir } from 'os';
import { join } from 'path';
import type { RawMCPServerConfig } from 'pulse-coder-engine';

/**
 * Root for all canvas workspace config. Computed lazily so tests can
 * override it by setting `PULSE_CANVAS_CONFIG_ROOT` before invoking any
 * read/write. Production code leaves the env var unset and falls back to
 * `~/.pulse-coder/canvas`.
 */
function storeRoot(): string {
  const override = process.env.PULSE_CANVAS_CONFIG_ROOT;
  if (override && override.trim()) return override;
  return join(homedir(), '.pulse-coder', 'canvas');
}

const GLOBAL_DIR = (): string => join(storeRoot(), 'global');

export const MCP_FILE = 'mcp.json';
export const SKILLS_FILE = 'skills.json';

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

export interface WorkspaceMCPConfig {
  mcpServers?: Record<string, RawMCPServerConfig>;
}

export type SkillSource =
  | { type: 'inline'; content: string }
  | { type: 'url'; url: string; headers?: Record<string, string> }
  | { type: 'git'; url: string; ref?: string; path?: string };

export interface WorkspaceSkillEntry {
  name: string;
  description?: string;
  source: SkillSource;
}

export interface WorkspaceSkillsConfig {
  skills?: WorkspaceSkillEntry[];
}

export interface MergedWorkspaceConfig {
  mcpServers: Record<string, RawMCPServerConfig>;
  skills: WorkspaceSkillEntry[];
  /** sha256 of the canonicalised merged config, for cheap change detection. */
  configHash: string;
}

// ---------------------------------------------------------------------------
// Path helpers
// ---------------------------------------------------------------------------

function workspaceDir(workspaceId: string): string {
  return join(storeRoot(), workspaceId);
}

export function configPaths(workspaceId: string): {
  globalMcp: string;
  globalSkills: string;
  workspaceMcp: string;
  workspaceSkills: string;
} {
  return {
    globalMcp: join(GLOBAL_DIR(), MCP_FILE),
    globalSkills: join(GLOBAL_DIR(), SKILLS_FILE),
    workspaceMcp: join(workspaceDir(workspaceId), MCP_FILE),
    workspaceSkills: join(workspaceDir(workspaceId), SKILLS_FILE),
  };
}

// ---------------------------------------------------------------------------
// File I/O
// ---------------------------------------------------------------------------

async function readJsonFile<T>(path: string): Promise<T | null> {
  try {
    const raw = await fs.readFile(path, 'utf-8');
    return JSON.parse(raw) as T;
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code === 'ENOENT') return null;
    console.warn(`[workspace-config] failed to read ${path}: ${(err as Error).message}`);
    return null;
  }
}

async function writeJsonFileAtomic(path: string, value: unknown): Promise<void> {
  const dir = path.substring(0, path.lastIndexOf('/'));
  await fs.mkdir(dir, { recursive: true });
  const tmp = `${path}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(value, null, 2), 'utf-8');
  await fs.rename(tmp, path);
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

export function validateMCPConfig(raw: unknown): WorkspaceMCPConfig {
  if (!isPlainObject(raw)) return {};
  const servers = raw.mcpServers ?? (raw as Record<string, unknown>).servers;
  if (!isPlainObject(servers)) return {};
  const out: Record<string, RawMCPServerConfig> = {};
  for (const [name, cfg] of Object.entries(servers)) {
    if (typeof name !== 'string' || !name.trim()) continue;
    if (!isPlainObject(cfg)) continue;
    out[name] = cfg as RawMCPServerConfig;
  }
  return { mcpServers: out };
}

function validateSkillSource(raw: unknown): SkillSource | null {
  if (!isPlainObject(raw)) return null;
  if (raw.type === 'inline' && typeof raw.content === 'string') {
    return { type: 'inline', content: raw.content };
  }
  if (raw.type === 'url' && typeof raw.url === 'string') {
    const out: SkillSource = { type: 'url', url: raw.url };
    if (isPlainObject(raw.headers)) {
      const hs: Record<string, string> = {};
      for (const [k, v] of Object.entries(raw.headers)) {
        if (typeof v === 'string') hs[k] = v;
      }
      out.headers = hs;
    }
    return out;
  }
  if (raw.type === 'git' && typeof raw.url === 'string') {
    return {
      type: 'git',
      url: raw.url,
      ref: typeof raw.ref === 'string' ? raw.ref : undefined,
      path: typeof raw.path === 'string' ? raw.path : undefined,
    };
  }
  return null;
}

export function validateSkillsConfig(raw: unknown): WorkspaceSkillsConfig {
  if (!isPlainObject(raw) || !Array.isArray(raw.skills)) return {};
  const out: WorkspaceSkillEntry[] = [];
  for (const entry of raw.skills) {
    if (!isPlainObject(entry)) continue;
    if (typeof entry.name !== 'string' || !entry.name.trim()) continue;
    const source = validateSkillSource(entry.source);
    if (!source) continue;
    out.push({
      name: entry.name.trim(),
      description: typeof entry.description === 'string' ? entry.description : undefined,
      source,
    });
  }
  return { skills: out };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function readMergedConfig(workspaceId: string): Promise<MergedWorkspaceConfig> {
  const paths = configPaths(workspaceId);

  const [globalMcpRaw, workspaceMcpRaw, globalSkillsRaw, workspaceSkillsRaw] = await Promise.all([
    readJsonFile<unknown>(paths.globalMcp),
    readJsonFile<unknown>(paths.workspaceMcp),
    readJsonFile<unknown>(paths.globalSkills),
    readJsonFile<unknown>(paths.workspaceSkills),
  ]);

  const globalMcp = validateMCPConfig(globalMcpRaw);
  const workspaceMcp = validateMCPConfig(workspaceMcpRaw);
  const globalSkills = validateSkillsConfig(globalSkillsRaw);
  const workspaceSkills = validateSkillsConfig(workspaceSkillsRaw);

  // MCP: workspace overrides global on server-name collision (full replace).
  const mergedServers: Record<string, RawMCPServerConfig> = {
    ...(globalMcp.mcpServers ?? {}),
    ...(workspaceMcp.mcpServers ?? {}),
  };

  // Skills: workspace overrides global on name collision.
  const mergedSkillsMap = new Map<string, WorkspaceSkillEntry>();
  for (const s of globalSkills.skills ?? []) mergedSkillsMap.set(s.name, s);
  for (const s of workspaceSkills.skills ?? []) mergedSkillsMap.set(s.name, s);
  const mergedSkills = Array.from(mergedSkillsMap.values());

  return {
    mcpServers: mergedServers,
    skills: mergedSkills,
    configHash: hashConfig(mergedServers, mergedSkills),
  };
}

function hashConfig(
  servers: Record<string, RawMCPServerConfig>,
  skills: WorkspaceSkillEntry[],
): string {
  // Sort keys for stable hashing.
  const stable = JSON.stringify({
    mcpServers: Object.fromEntries(
      Object.keys(servers).sort().map((k) => [k, servers[k]]),
    ),
    skills: [...skills].sort((a, b) => a.name.localeCompare(b.name)),
  });
  return createHash('sha256').update(stable).digest('hex');
}

export async function saveMCPConfig(
  scope: { kind: 'global' } | { kind: 'workspace'; workspaceId: string },
  config: WorkspaceMCPConfig,
): Promise<void> {
  const validated = validateMCPConfig(config);
  const target =
    scope.kind === 'global'
      ? join(GLOBAL_DIR(), MCP_FILE)
      : join(workspaceDir(scope.workspaceId), MCP_FILE);
  await writeJsonFileAtomic(target, validated);
}

export async function saveSkillsConfig(
  scope: { kind: 'global' } | { kind: 'workspace'; workspaceId: string },
  config: WorkspaceSkillsConfig,
): Promise<void> {
  const validated = validateSkillsConfig(config);
  const target =
    scope.kind === 'global'
      ? join(GLOBAL_DIR(), SKILLS_FILE)
      : join(workspaceDir(scope.workspaceId), SKILLS_FILE);
  await writeJsonFileAtomic(target, validated);
}
