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

/**
 * Library-level behavior settings (stored alongside the roles in roles.json).
 * `allowRoleHandoff` is the agent@agent switch: when ON, a role's reply may
 * hand the floor to other roles by writing plain `@RoleName`, which appends
 * them to the SAME turn's relay queue. Default OFF — replies then treat
 * @names as ordinary text, exactly the pre-P2 behavior.
 */
export interface AgentRoleLibrarySettings {
  allowRoleHandoff: boolean;
}

export const DEFAULT_AGENT_ROLE_SETTINGS: AgentRoleLibrarySettings = {
  allowRoleHandoff: false,
};

export const normalizeAgentRoleSettings = (value: unknown): AgentRoleLibrarySettings => ({
  allowRoleHandoff: (value as Partial<AgentRoleLibrarySettings> | null | undefined)?.allowRoleHandoff === true,
});

/**
 * Hard cap on segments per turn. User-named speakers are never truncated;
 * the cap bounds AUTO-GROWTH — handoffs stop appending once the queue holds
 * this many segments, so two roles can never ping-pong a turn forever.
 */
export const ROLE_RELAY_MAX_SEGMENTS = 6;

/** Preload surface: `window.canvasWorkspace.agentRoles`. */
export interface AgentRolesApi {
  list: () => Promise<AgentRolesResult<{ roles: AgentRoleDefinition[] }>>;
  save: (input: AgentRoleSaveInput) => Promise<AgentRolesResult<{ role: AgentRoleDefinition }>>;
  remove: (id: string) => Promise<AgentRolesResult<{ removed: boolean }>>;
  getSettings: () => Promise<AgentRolesResult<{ settings: AgentRoleLibrarySettings }>>;
  saveSettings: (settings: AgentRoleLibrarySettings) => Promise<AgentRolesResult<{ settings: AgentRoleLibrarySettings }>>;
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
 * Every role marker in a message, in order of first appearance, deduped by
 * role id. One message @-ing several roles is a RELAY: the roles reply in
 * this order, each as its own attributed message.
 */
export function parseRoleMentions(text: string): RoleMentionRef[] {
  const re = new RegExp(ROLE_MENTION_RE.source, 'g');
  const mentions: RoleMentionRef[] = [];
  const seen = new Set<string>();
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    const roleId = match[1].trim();
    if (!roleId || seen.has(roleId)) continue;
    seen.add(roleId);
    const name = match[2].trim();
    mentions.push({ roleId, name: name || roleId });
  }
  return mentions;
}

/** First role marker — the single-speaker view of {@link parseRoleMentions}. */
export function parseFirstRoleMention(text: string): RoleMentionRef | null {
  return parseRoleMentions(text)[0] ?? null;
}

// ─── Relay (multi-role turn) stream events ──────────────────────────

export interface RoleTurnRoleRef {
  id: string;
  name: string;
  color: string;
  /** Set on auto-appended queue entries: name of the role whose reply @-ed this one in. */
  namedBy?: string;
}

/** Pushed before each segment of a turn (single-speaker turns emit one with total=1). */
export interface RoleTurnStartEvent {
  index: number;
  total: number;
  /** null → the default assistant speaks this segment. */
  speakerRole: RoleTurnRoleRef | null;
  /** Full relay queue, so the renderer can draw progress from the first event. */
  queue: Array<RoleTurnRoleRef | null>;
}

/** Pushed after a segment's run finished successfully. */
export interface RoleTurnEndEvent {
  index: number;
  total: number;
  response: string;
  runId?: string;
  speakerRole: RoleTurnRoleRef | null;
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

/**
 * Plain-text `@RoleName` occurrences in a role's REPLY — the agent@agent
 * handoff signal. Name-based on purpose: models write plain group-chat
 * addresses (the same `@name` form they see in user text), never internal
 * `@[role:...]` markers. Longest name wins at any position and the matched
 * span is consumed, so with roles "评审" and "评审员" the text "@评审员"
 * counts only for 评审员. Case-insensitive for ASCII names. Returns
 * canonical names in first-occurrence order, deduped.
 */
export function findRoleNameMentions(text: string, names: readonly string[]): string[] {
  const candidates = [...new Set(names.map(name => name.trim()).filter(Boolean))]
    .sort((a, b) => b.length - a.length);
  if (candidates.length === 0 || !text.includes('@')) return [];

  // Lowercased haystack for ASCII-insensitive matching. Any lowercase that
  // shifts code-unit offsets (exotic unicode) falls back to exact-case for
  // that string, so match spans always share one coordinate space.
  const lowerText = text.toLowerCase();
  const insensitiveMode = lowerText.length === text.length;
  const haystack = insensitiveMode ? lowerText : text;
  const consumed: Array<[number, number]> = [];
  const hits: Array<{ pos: number; name: string }> = [];

  for (const name of candidates) {
    const lowerName = name.toLowerCase();
    const insensitive = insensitiveMode && lowerName.length === name.length;
    const source = insensitive ? haystack : text;
    const needle = `@${insensitive ? lowerName : name}`;
    let from = 0;
    while (true) {
      const pos = source.indexOf(needle, from);
      if (pos === -1) break;
      const end = pos + needle.length;
      if (!consumed.some(([start, stop]) => pos < stop && end > start)) {
        consumed.push([pos, end]);
        hits.push({ pos, name });
      }
      from = pos + 1;
    }
  }

  hits.sort((a, b) => a.pos - b.pos);
  const seen = new Set<string>();
  const ordered: string[] = [];
  for (const hit of hits) {
    if (seen.has(hit.name)) continue;
    seen.add(hit.name);
    ordered.push(hit.name);
  }
  return ordered;
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
