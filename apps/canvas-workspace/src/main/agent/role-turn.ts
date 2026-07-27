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
  parseFirstRoleMention,
  stripRoleMentionMarkers,
  type AgentRoleDefinition,
} from '../../shared/agent-roles';
import { getAgentRole } from './roles-store';
import type { CanvasAgentMessage } from './types';

/**
 * Role addressed by `message`, or null when the message has no role marker
 * or the marker points at a role that no longer exists (stale mention after
 * a delete → the turn degrades to the default assistant).
 */
export async function resolveActiveRole(message: string): Promise<AgentRoleDefinition | null> {
  const mention = parseFirstRoleMention(message);
  if (!mention) return null;
  try {
    return await getAgentRole(mention.roleId);
  } catch (err) {
    console.warn('[canvas-agent] failed to resolve role mention, using default assistant:', err);
    return null;
  }
}

/**
 * Persona section appended to the system prompt when a role speaks. The
 * multi-party protocol note is included so the role reads the labeled
 * history correctly and never writes its own label.
 */
export function formatActiveRoleSection(role: AgentRoleDefinition): string {
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
