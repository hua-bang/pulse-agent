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
  findRoleNameMentions,
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
 * Impersonation guard for one role segment's raw output.
 *
 * The model sees a history full of 【Name】 prefixes (that's how roles read
 * each other) and imitates the pattern — especially when the user asks for
 * "10 rounds", which one segment cannot deliver: it starts writing the other
 * roles' turns inside its own reply. The prompt forbids this; this is the
 * enforcement that does not depend on the model complying.
 *
 * Two rules: drop a leading 【self】 label, and truncate at the first 【other
 * role】 label that starts a turn (line start, or after sentence-ending
 * punctuation) — the truncated part is exactly what the NEXT segment's real
 * speaker will say. Labels that are not known role names (e.g. a topic
 * written as 【AI 对人的影响】) are left alone.
 */
export function sanitizeRoleSegmentText(
  text: string,
  speakerName: string,
  knownRoleNames: Iterable<string>,
): string {
  // SELF labels are stripped wherever they appear (a reply that restates the
  // question first puts its own label mid-text, not at the start; the content
  // after it is the role's own valid answer, so truncating would eat it).
  let out = stripSpeakerSelfLabels(text, speakerName);

  const others = [...knownRoleNames].filter(name => name && name !== speakerName);
  let cut = -1;
  for (const name of others) {
    const re = new RegExp(`(^|[\\n。！？!?])\\s*【\\s*${escapeRegExp(name)}\\s*】`, 'g');
    const match = re.exec(out);
    if (!match) continue;
    // Keep the punctuation that ended the previous sentence.
    const at = match.index + match[1].length;
    if (cut === -1 || at < cut) cut = at;
  }
  if (cut >= 0) out = out.slice(0, cut);

  return out.trim();
}

/** Remove every 【speaker】 label — the system owns attribution, a reply never legitimately contains its own. */
export function stripSpeakerSelfLabels(text: string, speakerName: string): string {
  if (!speakerName || !text.includes('【')) return text;
  return text.replace(new RegExp(`【\\s*${escapeRegExp(speakerName)}\\s*】\\s*`, 'g'), '');
}

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Push a sanitized segment text back into the model history: without this the
 * truncated impersonation would stay in the live messages and the NEXT
 * speaker would read it as real. Rewrites the LAST assistant text (the
 * segment's final answer); tool-call frames and earlier steps are untouched.
 * Call BEFORE the speaker label is applied.
 */
export function replaceFinalAssistantText(messages: ModelMessage[], text: string): void {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if ((message as { role?: string }).role !== 'assistant') continue;
    const content = (message as { content: unknown }).content;
    if (typeof content === 'string') {
      if (!content.trim()) continue;
      (message as { content: string }).content = text;
      return;
    }
    if (!Array.isArray(content)) continue;
    const part = content.find(
      entry => entry && typeof entry === 'object'
        && (entry as { type?: string }).type === 'text'
        && typeof (entry as { text?: unknown }).text === 'string'
        && (entry as { text: string }).text.trim(),
    );
    if (!part) continue;
    (part as { text: string }).text = text;
    return;
  }
}

/**
 * Handoff TARGET policy: externally-driven roles (local coding agents with
 * real side effects) may only speak when the USER @-mentions them directly —
 * another role's reply can never pull them in. Persona roles remain valid
 * targets. Used to build both the target library and the advertised @names.
 */
export const handoffTargetRoles = (roles: AgentRoleDefinition[]): AgentRoleDefinition[] =>
  roles.filter(role => !role.external);

/**
 * Agent@agent handoff policy: which roles a finished segment's reply hands
 * the floor to. Mentions are matched by NAME against the live library (see
 * `findRoleNameMentions`), then filtered — self-mentions dropped, roles
 * already WAITING in the queue not re-added (roles that already spoke may
 * re-enter, that's how back-and-forth works), growth truncated at
 * `capacity` so a turn never exceeds ROLE_RELAY_MAX_SEGMENTS segments.
 */
export function resolveHandoffRoles(
  replyText: string,
  opts: {
    speaker: AgentRoleDefinition;
    libraryRoles: AgentRoleDefinition[];
    pendingIds: Iterable<string>;
    capacity: number;
  },
): AgentRoleDefinition[] {
  if (opts.capacity <= 0) return [];
  const byName = new Map(opts.libraryRoles.map(role => [role.name, role]));
  const blocked = new Set(opts.pendingIds);
  blocked.add(opts.speaker.id);

  const handoffs: AgentRoleDefinition[] = [];
  for (const name of findRoleNameMentions(replyText, opts.libraryRoles.map(role => role.name))) {
    const role = byName.get(name);
    if (!role || blocked.has(role.id)) continue;
    blocked.add(role.id);
    handoffs.push(role);
    if (handoffs.length >= opts.capacity) break;
  }
  return handoffs;
}

/**
 * Persona section appended to the system prompt when a role speaks. The
 * multi-party protocol note is included so the role reads the labeled
 * history correctly and never writes its own label. In a relay, the role is
 * told its position so it builds on (rather than repeats) earlier speakers.
 * When the agent@agent switch is ON, `handoff.otherNames` lists the roles
 * this speaker may @-mention to hand the floor to.
 */
export function formatActiveRoleSection(
  role: AgentRoleDefinition,
  relay?: { index: number; total: number },
  handoff?: { otherNames: string[] },
): string {
  const relayNote = relay && relay.total > 1
    ? [
        `- This turn is a RELAY: ${relay.total} roles reply in order to the same user message, and you are speaker ${relay.index + 1} of ${relay.total}. Earlier speakers' replies for this turn are already in the history — respond to them where relevant instead of repeating their points.`,
        '- Form your OWN judgment first, then engage earlier speakers. Disagree openly when you disagree — do not echo or pile on agreement out of politeness.',
      ]
    : [];
  const otherNames = handoff?.otherNames.filter(name => name && name !== role.name) ?? [];
  const handoffNote = otherNames.length > 0
    ? [
        `- Handing off: you may bring another role into this turn by writing @RoleName in your reply (available: ${otherNames.map(name => `@${name}`).join(', ')}). They will speak after you. Use it ONLY when their perspective is genuinely needed — no courtesy mentions, never @ yourself, and expect at most a few handoffs per turn (the queue is capped).`,
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
    '- Your reply is ONE turn by ONE speaker. Never write 【...】 anywhere (attribution is added by the system), never write another role\'s turn, and do NOT pack several rounds into one reply — anything past your own single turn is discarded. Answer directly instead of restating the question that was addressed to you. When the user asks for many rounds, deliver them by @-ing the next speaker at the end of your turn; the system keeps the discussion going round by round.',
    ...relayNote,
    ...handoffNote,
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
  // Assistant projection also scrubs stray self-labels from STORED content —
  // messages persisted before the impersonation guard existed carry them, and
  // replaying them verbatim teaches the model to imitate the pattern. The one
  // canonical label is then prepended, same as the live path.
  const content = message.role === 'assistant'
    ? labelAssistantContent(
        message.speakerRoleName ? stripSpeakerSelfLabels(base, message.speakerRoleName) : base,
        message.speakerRoleName,
      )
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
