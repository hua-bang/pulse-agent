/**
 * Agent role library — persistence for the multi-role chat personas.
 *
 * Stored at ~/.pulse-coder/canvas/roles.json (same layout choice as
 * prompt-profile.json): one global library shared by every chat scope, so a
 * persona defined once is @-mentionable from any workspace, the global chat,
 * and scheduled-task chats alike.
 */

import { promises as fs } from 'fs';
import { randomBytes } from 'crypto';
import { homedir } from 'os';
import { dirname, join } from 'path';
import {
  AGENT_ROLE_COLORS,
  AGENT_ROLE_PROMPT_MAX_LENGTH,
  isValidAgentRoleColor,
  normalizeAgentRoleSettings,
  sanitizeAgentRoleName,
  type AgentRoleDefinition,
  type AgentRoleLibrarySettings,
  type AgentRoleSaveInput,
} from '../../shared/agent-roles';

function getRolesPath(): string {
  const envPath = process.env.PULSE_CANVAS_AGENT_ROLES?.trim();
  return envPath || join(homedir(), '.pulse-coder', 'canvas', 'roles.json');
}

function normalizeRole(value: unknown): AgentRoleDefinition | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Partial<AgentRoleDefinition>;
  if (typeof raw.id !== 'string' || !raw.id.trim()) return null;
  const name = sanitizeAgentRoleName(typeof raw.name === 'string' ? raw.name : '');
  if (!name) return null;
  return {
    id: raw.id.trim(),
    name,
    color: typeof raw.color === 'string' && isValidAgentRoleColor(raw.color)
      ? raw.color.toLowerCase()
      : AGENT_ROLE_COLORS[0],
    prompt: typeof raw.prompt === 'string' ? raw.prompt.trim().slice(0, AGENT_ROLE_PROMPT_MAX_LENGTH) : '',
    createdAt: typeof raw.createdAt === 'number' ? raw.createdAt : 0,
    updatedAt: typeof raw.updatedAt === 'number' ? raw.updatedAt : 0,
  };
}

interface AgentRoleLibrary {
  roles: AgentRoleDefinition[];
  settings: AgentRoleLibrarySettings;
}

async function readLibrary(): Promise<AgentRoleLibrary> {
  try {
    const raw = await fs.readFile(getRolesPath(), 'utf8');
    const parsed = JSON.parse(raw) as unknown;
    const list = Array.isArray(parsed) ? parsed : (parsed as { roles?: unknown[] })?.roles;
    const settings = normalizeAgentRoleSettings(
      Array.isArray(parsed) ? undefined : (parsed as { settings?: unknown })?.settings,
    );
    if (!Array.isArray(list)) return { roles: [], settings };
    const roles: AgentRoleDefinition[] = [];
    const seenIds = new Set<string>();
    for (const entry of list) {
      const role = normalizeRole(entry);
      if (role && !seenIds.has(role.id)) {
        seenIds.add(role.id);
        roles.push(role);
      }
    }
    return { roles, settings };
  } catch (err: any) {
    if (err?.code === 'ENOENT') return { roles: [], settings: normalizeAgentRoleSettings(undefined) };
    throw err;
  }
}

async function readRoles(): Promise<AgentRoleDefinition[]> {
  return (await readLibrary()).roles;
}

/** Role writes go through here so library settings survive every role edit. */
async function writeRoles(roles: AgentRoleDefinition[]): Promise<void> {
  const { settings } = await readLibrary();
  await writeLibrary({ roles, settings });
}

async function writeLibrary(library: AgentRoleLibrary): Promise<void> {
  const path = getRolesPath();
  await fs.mkdir(dirname(path), { recursive: true });
  await fs.writeFile(path, `${JSON.stringify(library, null, 2)}\n`, 'utf8');
}

function pickDefaultColor(roles: AgentRoleDefinition[]): string {
  const used = new Set(roles.map(role => role.color));
  return AGENT_ROLE_COLORS.find(color => !used.has(color)) ?? AGENT_ROLE_COLORS[roles.length % AGENT_ROLE_COLORS.length];
}

export async function listAgentRoles(): Promise<AgentRoleDefinition[]> {
  return readRoles();
}

export async function getAgentRole(id: string): Promise<AgentRoleDefinition | null> {
  const roles = await readRoles();
  return roles.find(role => role.id === id) ?? null;
}

export async function saveAgentRole(input: AgentRoleSaveInput): Promise<AgentRoleDefinition> {
  const name = sanitizeAgentRoleName(input.name ?? '');
  if (!name) throw new Error('Role name is required');
  const prompt = (input.prompt ?? '').trim().slice(0, AGENT_ROLE_PROMPT_MAX_LENGTH);
  if (!prompt) throw new Error('Role prompt is required');

  const roles = await readRoles();
  const targetId = input.id?.trim();
  const existing = targetId ? roles.find(role => role.id === targetId) : undefined;
  if (targetId && !existing) throw new Error(`Role not found: ${targetId}`);

  const duplicate = roles.find(
    role => role.id !== existing?.id && role.name.toLowerCase() === name.toLowerCase(),
  );
  if (duplicate) throw new Error(`A role named "${name}" already exists`);

  const now = Date.now();
  const color = input.color && isValidAgentRoleColor(input.color)
    ? input.color.toLowerCase()
    : existing?.color ?? pickDefaultColor(roles);

  if (existing) {
    existing.name = name;
    existing.color = color;
    existing.prompt = prompt;
    existing.updatedAt = now;
    await writeRoles(roles);
    return existing;
  }

  const role: AgentRoleDefinition = {
    id: `role-${now.toString(36)}-${randomBytes(3).toString('hex')}`,
    name,
    color,
    prompt,
    createdAt: now,
    updatedAt: now,
  };
  roles.push(role);
  await writeRoles(roles);
  return role;
}

export async function deleteAgentRole(id: string): Promise<boolean> {
  const roles = await readRoles();
  const next = roles.filter(role => role.id !== id);
  if (next.length === roles.length) return false;
  await writeRoles(next);
  return true;
}

export async function getAgentRoleSettings(): Promise<AgentRoleLibrarySettings> {
  return (await readLibrary()).settings;
}

export async function saveAgentRoleSettings(input: unknown): Promise<AgentRoleLibrarySettings> {
  const { roles } = await readLibrary();
  const settings = normalizeAgentRoleSettings(input);
  await writeLibrary({ roles, settings });
  return settings;
}
