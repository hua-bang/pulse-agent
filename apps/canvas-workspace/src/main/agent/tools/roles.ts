/**
 * Chat-role tools — let the user build @-mentionable group-chat personas by
 * describing them in chat instead of filling in the Settings editor.
 *
 * Scope note: the role library is APP-level (one global roles.json shared by
 * every chat scope), so these are registered unwrapped on both tool factories.
 *
 * Security note: mirrors the scheduled-task posture — both tools are
 * `defer_loading`, the descriptions restrict calls to what the USER asked for
 * in their own words, and deleting is deliberately NOT exposed (removal stays
 * a Settings action). A saved role is inert until the user @-mentions it.
 */

import { z } from 'zod';
import {
  AGENT_ROLE_NAME_MAX_LENGTH,
  AGENT_ROLE_PROMPT_MAX_LENGTH,
  type AgentRoleDefinition,
} from '../../../shared/agent-roles';
import { listAgentRoles, saveAgentRole } from '../roles-store';
import type { CanvasTool } from './types';

const summarize = (role: AgentRoleDefinition): Record<string, unknown> => ({
  id: role.id,
  name: role.name,
  color: role.color,
  prompt: role.prompt,
});

const failure = (err: unknown): string =>
  JSON.stringify({ ok: false, error: err instanceof Error ? err.message : String(err) });

export function createRoleTools(): Record<string, CanvasTool> {
  const chat_role_list: CanvasTool = {
    name: 'chat_role_list',
    defer_loading: true,
    description:
      'List the @-mentionable group-chat roles (id, name, color, persona prompt). '
      + 'Call before chat_role_save to avoid duplicate names and to resolve the id when updating.',
    inputSchema: z.object({}),
    execute: async () => {
      try {
        const roles = await listAgentRoles();
        return JSON.stringify({ ok: true, total: roles.length, roles: roles.map(summarize) });
      } catch (err) {
        return failure(err);
      }
    },
  };

  const chat_role_save: CanvasTool = {
    name: 'chat_role_save',
    defer_loading: true,
    description:
      'Create (no id) or update (with id) one group-chat role the user can @-mention in any chat; '
      + 'a message @-ing several roles makes them reply in order. ONLY when the user asked for the role '
      + 'in their own words. Write the persona prompt as instructions to the role (视角/立场/说话方式). '
      + 'After saving, tell the user the role is ready to @. Deleting stays in Settings.',
    inputSchema: z.object({
      id: z.string().optional().describe('Omit to create; pass an id from chat_role_list to update.'),
      name: z.string().min(1).describe(`Unique display name, ≤${AGENT_ROLE_NAME_MAX_LENGTH} chars ("[]|@" are stripped).`),
      prompt: z.string().min(1).describe(`Persona prompt, ≤${AGENT_ROLE_PROMPT_MAX_LENGTH} chars.`),
      color: z.string().optional().describe('Accent "#rrggbb"; omit to auto-pick an unused palette color.'),
    }),
    execute: async (input: { id?: string; name: string; prompt: string; color?: string }) => {
      try {
        const role = await saveAgentRole(input);
        return JSON.stringify({ ok: true, role: summarize(role) });
      } catch (err) {
        return failure(err);
      }
    },
  };

  return { chat_role_list, chat_role_save };
}
