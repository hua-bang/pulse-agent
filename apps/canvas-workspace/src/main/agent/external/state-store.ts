/**
 * Session continuity for externally-driven roles: one CLI session id per
 * (chat session × role), persisted at
 * ~/.pulse-coder/canvas/external-agent-state.json. A stored id is only
 * reused while the role's family AND cwd are unchanged (same invalidation
 * rule as the ACP package's channel state) — a driver edit starts fresh.
 * Lookups degrade to "no session" on any read error: worst case the agent
 * re-reads the rendered context instead of resuming.
 */

import { promises as fs } from 'fs';
import { homedir } from 'os';
import { dirname, join } from 'path';
import type { AgentRoleDefinition, AgentRoleExternalDriver } from '../../../shared/agent-roles';

interface ExternalChannelState {
  family: AgentRoleExternalDriver['family'];
  cwd: string;
  sessionId: string;
  updatedAt: number;
}

interface ExternalStateFile {
  channels: Record<string, ExternalChannelState>;
}

function getStatePath(): string {
  const envPath = process.env.PULSE_CANVAS_EXTERNAL_AGENT_STATE?.trim();
  return envPath || join(homedir(), '.pulse-coder', 'canvas', 'external-agent-state.json');
}

const channelKey = (chatSessionId: string, roleId: string): string => `${chatSessionId}:${roleId}`;

async function readState(): Promise<ExternalStateFile> {
  try {
    const raw = await fs.readFile(getStatePath(), 'utf8');
    const parsed = JSON.parse(raw) as Partial<ExternalStateFile> | null;
    return { channels: parsed?.channels && typeof parsed.channels === 'object' ? parsed.channels : {} };
  } catch {
    return { channels: {} };
  }
}

async function writeState(state: ExternalStateFile): Promise<void> {
  const path = getStatePath();
  await fs.mkdir(dirname(path), { recursive: true });
  await fs.writeFile(path, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
}

export async function getExternalSessionId(
  chatSessionId: string,
  role: Pick<AgentRoleDefinition, 'id'> & { external: AgentRoleExternalDriver },
): Promise<string | undefined> {
  const state = await readState();
  const channel = state.channels[channelKey(chatSessionId, role.id)];
  if (!channel) return undefined;
  if (channel.family !== role.external.family || channel.cwd !== role.external.cwd) return undefined;
  return channel.sessionId || undefined;
}

export async function saveExternalSessionId(
  chatSessionId: string,
  role: Pick<AgentRoleDefinition, 'id'> & { external: AgentRoleExternalDriver },
  sessionId: string,
): Promise<void> {
  if (!sessionId) return;
  try {
    const state = await readState();
    state.channels[channelKey(chatSessionId, role.id)] = {
      family: role.external.family,
      cwd: role.external.cwd,
      sessionId,
      updatedAt: Date.now(),
    };
    await writeState(state);
  } catch (err) {
    console.warn('[canvas-agent] failed to persist external session id:', err);
  }
}

export async function clearExternalSessionId(chatSessionId: string, roleId: string): Promise<void> {
  try {
    const state = await readState();
    if (!(channelKey(chatSessionId, roleId) in state.channels)) return;
    delete state.channels[channelKey(chatSessionId, roleId)];
    await writeState(state);
  } catch {
    /* best effort */
  }
}
