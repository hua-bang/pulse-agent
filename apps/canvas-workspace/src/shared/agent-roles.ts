/**
 * Agent chat roles — shared contract for the multi-role ("group chat")
 * AI Chat feature.
 *
 * A role is a named persona (name + prompt + color) stored in a single
 * global library. The user addresses a turn to a role by @-mentioning it
 * in the composer; the mention serializes to a `@[role:<id>|<name>]`
 * marker inside the message text. The main process derives the active
 * role for a turn by parsing the FIRST role marker from the message —
 * there is no separate roleId IPC field, so edit/regenerate flows that
 * replay the original message text keep their role for free.
 */

// ─── Role definition ────────────────────────────────────────────────

export interface AgentRoleDefinition {
  id: string;
  name: string;
  /** Hex accent color, `#rrggbb`. */
  color: string;
  /** Persona system-prompt fragment injected when this role speaks. */
  prompt: string;
  createdAt: number;
  updatedAt: number;
}

export interface AgentRoleSaveInput {
  /** Present → update that role; absent → create a new one. */
  id?: string;
  name: string;
  color?: string;
  prompt: string;
}

export type AgentRolesResult<T> = ({ ok: true } & T) | { ok: false; error: string };

/** Preload surface: `window.canvasWorkspace.agentRoles`. */
export interface AgentRolesApi {
  list: () => Promise<AgentRolesResult<{ roles: AgentRoleDefinition[] }>>;
  save: (input: AgentRoleSaveInput) => Promise<AgentRolesResult<{ role: AgentRoleDefinition }>>;
  remove: (id: string) => Promise<AgentRolesResult<{ removed: boolean }>>;
}

// ─── Validation limits (shared so UI and store agree) ───────────────

export const AGENT_ROLE_NAME_MAX_LENGTH = 20;
export const AGENT_ROLE_PROMPT_MAX_LENGTH = 4000;

/** Default swatch palette — mirrors the app's node accent colors. */
export const AGENT_ROLE_COLORS = [
  '#d9730d', '#2383e2', '#0f7b6c', '#a594e0', '#c14b42', '#b08800',
] as const;

export const isValidAgentRoleColor = (value: string): boolean =>
  /^#[0-9a-fA-F]{6}$/.test(value);

/**
 * Role names travel inside `@[role:<id>|<name>]` markers, so the marker
 * syntax characters are stripped rather than rejected.
 */
export const sanitizeAgentRoleName = (value: string): string =>
  value.replace(/[[\]|@\n\r]/g, '').trim().slice(0, AGENT_ROLE_NAME_MAX_LENGTH);

// ─── Mention marker ─────────────────────────────────────────────────

export const ROLE_MENTION_PREFIX = 'role:';

/** `@[role:<id>|<name>]` — the composer chip's serialized form. */
export const buildRoleMentionMarker = (role: Pick<AgentRoleDefinition, 'id' | 'name'>): string =>
  `@[${ROLE_MENTION_PREFIX}${role.id}|${role.name}]`;

const ROLE_MENTION_RE = /@\[role:([^\]|]+)\|([^\]]*)\]/g;

export interface RoleMentionRef {
  roleId: string;
  name: string;
}

/**
 * First role marker in a message — the turn's addressed role. Later role
 * markers are deliberately ignored in P0 (one speaker per turn); they stay
 * in the text as plain references.
 */
export function parseFirstRoleMention(text: string): RoleMentionRef | null {
  const re = new RegExp(ROLE_MENTION_RE.source, 'g');
  const match = re.exec(text);
  if (!match) return null;
  const roleId = match[1].trim();
  const name = match[2].trim();
  if (!roleId) return null;
  return { roleId, name: name || roleId };
}

/**
 * Model-facing normalization: `@[role:<id>|<name>]` → `@<name>`. The raw
 * marker is stored (the UI renders it as a chip), but the model should read
 * a plain group-chat address instead of an internal id.
 */
export function stripRoleMentionMarkers(text: string): string {
  return text.replace(new RegExp(ROLE_MENTION_RE.source, 'g'), (_match, _id: string, name: string) => {
    const label = name.trim();
    return label ? `@${label}` : '';
  });
}

// ─── Speaker attribution ────────────────────────────────────────────

/**
 * Model-visible speaker label. Stored message content stays CLEAN (label in
 * metadata only); the label is prepended only on the model-facing copy so
 * every role can tell who said what in the shared history. The two injection
 * points — live push after a turn and session reload — MUST both go through
 * this helper (regression-tested) or roles start impersonating each other.
 */
export const formatSpeakerLabel = (name: string): string => `【${name}】`;

export const labelAssistantContent = (content: string, speakerName: string | undefined): string => {
  const name = speakerName?.trim();
  if (!name) return content;
  return `${formatSpeakerLabel(name)} ${content}`;
};
