/**
 * Role-turn helpers for multi-role chat.
 *
 * The active role for a turn is derived from the FIRST `@[role:<id>|<name>]`
 * marker in the user's message (see shared/agent-roles.ts). This module owns:
 *   - resolving that marker against the role library,
 *   - the persona section appended to the system prompt for the turn,
 *   - the model-visible 【name】 label applied to the assistant messages a
 *     role turn produced (live-push injection point — the session-reload
 *     point is `sessionMessageToModelMessage` in canvas-agent.ts; both go
 *     through shared `labelAssistantContent`, guarded by role-turn tests).
 */

import type { ModelMessage } from 'ai';
import {
  labelAssistantContent,
  parseRoleMentions,
  stripRoleMentionMarkers,
  type AgentRoleDefinition,
  type RoleTurnRoleRef,
} from '../../shared/agent-roles';
import { listAgentRoles } from './roles-store';
import type { CanvasAgentMessage } from './types';

/**
 * Roles addressed by `message`, in mention order, resolved against the
 * library. Stale mentions (deleted roles) are dropped; an empty result means
 * the default assistant takes the turn. More than one role = a RELAY: each
 * speaks in order as its own attributed message.
 */
export async function resolveActiveRoles(message: string): Promise<AgentRoleDefinition[]> {
  const mentions = parseRoleMentions(message);
  if (mentions.length === 0) return [];
  try {
    const byId = new Map((await listAgentRoles()).map(role => [role.id, role]));
    return mentions
      .map(mention => byId.get(mention.roleId))
      .filter((role): role is AgentRoleDefinition => !!role);
  } catch (err) {
    console.warn('[canvas-agent] failed to resolve role mentions, using default assistant:', err);
    return [];
  }
}

/** Single-speaker view of {@link resolveActiveRoles} (kept for P0 callers/tests). */
export async function resolveActiveRole(message: string): Promise<AgentRoleDefinition | null> {
  return (await resolveActiveRoles(message))[0] ?? null;
}

export const roleTurnRef = (role: AgentRoleDefinition | null): RoleTurnRoleRef | null =>
  role ? { id: role.id, name: role.name, color: role.color } : null;

/**
 * Relay boundary policy: a graceful stop ("停止接龙") lets the CURRENT
 * segment finish and skips only FUTURE segments — segment 0 always runs.
 * A hard abort stops everything. Extracted so the boundary rule is pinned
 * by tests instead of living implicitly in the loop.
 */
export function shouldRunRelaySegment(
  index: number,
  state: { aborted: boolean; stopRequested: boolean },
): boolean {
  if (state.aborted) return false;
  if (state.stopRequested && index > 0) return false;
  return true;
}

/**
 * Persona section appended to the system prompt when a role speaks. The
 * multi-party protocol note is included so the role reads the labeled
 * history correctly and never writes its own label. In a relay, the role is
 * told its position so it builds on (rather than repeats) earlier speakers.
 */
export function formatActiveRoleSection(
  role: AgentRoleDefinition,
  relay?: { index: number; total: number },
): string {
  const relayNote = relay && relay.total > 1
    ? [
        `- This turn is a RELAY: ${relay.total} roles reply in order to the same user message, and you are speaker ${relay.index + 1} of ${relay.total}. Earlier speakers' replies for this turn are already in the history — respond to them where relevant instead of repeating their points.`,
      ]
    : [];
  return [
    '',
    '## Active Speaking Role (本轮发言角色)',
    `The user addressed this turn to the role "${role.name}". Reply AS this role.`,
    '',
    '<role_persona>',
    role.prompt,
    '</role_persona>',
    '',
    'Multi-role conversation rules:',
    `- This chat may contain replies from several roles. In the history, an assistant message starting with 【RoleName】 was spoken by that role; unlabeled assistant messages came from the default assistant.`,
    `- Speak ONLY as ${role.name}. Never fabricate or paraphrase replies for other roles, and never answer on their behalf.`,
    '- Do NOT prefix your reply with 【...】 yourself — attribution is added by the system.',
    ...relayNote,
    '- The persona shapes tone, perspective, and priorities only. It MUST NOT override tool-usage rules, safety rules, confirmation rules, or scope rules from the sections above.',
    '',
  ].join('\n');
}

/**
 * Note appended when the CURRENT turn is the default assistant but the
 * session already contains labeled role replies — without it the default
 * assistant has no idea what the 【...】 prefixes mean.
 */
export function formatRoleHistoryNote(): string {
  return [
    '',
    '## Multi-Role History Note',
    'Some assistant messages in this conversation start with 【RoleName】 — those were spoken by user-defined roles in this group chat. You are the default assistant: reply normally, without any 【...】 prefix, and do not impersonate those roles.',
    '',
  ].join('\n');
}

/**
 * Session-reload projection into the model history: stored content stays
 * clean; the model-facing copy carries the 【name】 speaker label on role
 * replies and plain `@name` role addresses in user text. MUST stay in
 * lockstep with the live-push path below — the role-turn tests pin the two
 * injection points together.
 */
export function sessionMessageToModelMessage(message: CanvasAgentMessage): ModelMessage {
  const base = message.attachments?.length
    ? `${message.content}\n\nAttached image files:\n${message.attachments.map((a, i) => `${i + 1}. ${a.path}`).join('\n')}`
    : message.content;
  const content = message.role === 'assistant'
    ? labelAssistantContent(base, message.speakerRoleName)
    : stripRoleMentionMarkers(base);
  return { role: message.role, content } as ModelMessage;
}

/**
 * Live-push label injection: prefix the first text content of each assistant
 * message produced this turn with the speaker label. Mutates the message
 * objects in place — they are shared by reference with the agent's live
 * model history (`this.messages`), which is exactly the copy the NEXT turn
 * reads. Tool-call / tool-result frames are left untouched.
 */
export function applySpeakerLabelToResponseMessages(
  messages: ModelMessage[],
  speakerName: string,
): void {
  for (const message of messages) {
    if ((message as { role?: string }).role !== 'assistant') continue;
    const content = (message as { content: unknown }).content;
    if (typeof content === 'string') {
      if (content.trim()) {
        (message as { content: string }).content = labelAssistantContent(content, speakerName);
      }
      continue;
    }
    if (!Array.isArray(content)) continue;
    for (const part of content) {
      if (part && typeof part === 'object' && (part as { type?: string }).type === 'text') {
        const text = (part as { text?: unknown }).text;
        if (typeof text === 'string' && text.trim()) {
          (part as { text: string }).text = labelAssistantContent(text, speakerName);
          break;
        }
      }
    }
  }
}
