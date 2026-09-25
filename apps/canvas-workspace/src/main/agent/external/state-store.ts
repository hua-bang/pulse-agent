/**
 * Session continuity for externally-driven roles: one CLI session id per
 * (chat session × role), persisted at
 * ~/.pulse-coder/canvas/external-agent-state.json. A stored id is only
 * reused while the role's family AND cwd are unchanged (same invalidation
 * rule as the ACP package's channel state) — a driver edit starts fresh.
 * Lookups degrade to "no session" on any read error: worst case the agent
 * re-reads the rendered context instead of resuming. Updates are serialized
 * in-process and replace the file atomically, so concurrent roles cannot drop
 * each other's entries.
 */

import { promises as fs } from 'fs';
import { homedir } from 'os';
import { dirname, join } from 'path';
import { writeJsonAtomic } from '@pulse-coder/storage/local';
import type { AgentRoleExternalFamily } from '../../../shared/agent-roles';

/** Driver identity with the cwd RESOLVED (see external/cwd.ts) — never optional here. */
interface ResolvedDriverRef {
  id: string;
  external: { family: AgentRoleExternalFamily; cwd: string };
}

interface ExternalChannelState {
  family: AgentRoleExternalFamily;
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
  await writeJsonAtomic(path, state);
}

let updateTail: Promise<void> = Promise.resolve();

/** One read-modify-write at a time; a failed update does not block later ones. */
function updateState(mutate: (state: ExternalStateFile) => boolean): Promise<void> {
  const run = updateTail.then(async () => {
    const state = await readState();
    if (mutate(state)) await writeState(state);
  });
  updateTail = run.catch(() => undefined);
  return run;
}

export async function getExternalSessionId(
  chatSessionId: string,
  role: ResolvedDriverRef,
): Promise<string | undefined> {
  const state = await readState();
  const channel = state.channels[channelKey(chatSessionId, role.id)];
  if (!channel) return undefined;
  if (channel.family !== role.external.family || channel.cwd !== role.external.cwd) return undefined;
  return channel.sessionId || undefined;
}

export async function saveExternalSessionId(
  chatSessionId: string,
  role: ResolvedDriverRef,
  sessionId: string,
): Promise<void> {
  if (!sessionId) return;
  try {
    await updateState(state => {
      state.channels[channelKey(chatSessionId, role.id)] = {
        family: role.external.family,
        cwd: role.external.cwd,
        sessionId,
        updatedAt: Date.now(),
      };
      return true;
    });
  } catch (err) {
    console.warn('[canvas-agent] failed to persist external session id:', err);
  }
}

export async function clearExternalSessionId(chatSessionId: string, roleId: string): Promise<void> {
  try {
    await updateState(state => {
      if (!(channelKey(chatSessionId, roleId) in state.channels)) return false;
      delete state.channels[channelKey(chatSessionId, roleId)];
      return true;
    });
  } catch {
    /* best effort */
  }
}
