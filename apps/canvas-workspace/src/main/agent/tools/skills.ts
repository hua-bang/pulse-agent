/**
 * Skill-management tools for the canvas agent.
 *
 * These let the agent persist or promote skills mid-conversation, driven by
 * built-in SKILL.md instructions (see `default-skills.ts`). Both tools are
 * deliberately thin wrappers over the same config modules the settings UI
 * uses, so disk format and validation stay identical. After each write we
 * trigger an in-place rescan so the *current* run sees the change on its
 * next turn — no Engine rebuild, no new session.
 *
 * The "always confirm with the user first" rule lives in the SKILL.md, not
 * here. These tools deliberately do *not* prompt; if the agent calls them,
 * a write happens. That keeps the policy editable as content.
 */

import { z } from 'zod';
import {
  scopeSkillsDir,
  type CanvasConfigScope,
} from '../config-scope';
import {
  skillSlug,
  upsertCanvasSkill,
} from '../skills/config';
import { promoteCanvasSkill } from '../skills/promote';
import { getCanvasAgentService } from '../ipc';
import type { CanvasTool } from './types';

const scopeArg = z
  .enum(['workspace', 'global'])
  .optional()
  .describe('Where to save the skill. Defaults to "workspace" (this canvas only).');

async function refresh(scope: CanvasConfigScope): Promise<void> {
  await getCanvasAgentService().reloadSkills(
    scope.level === 'workspace' ? scope.workspaceId : undefined,
  );
}

export function createSkillTools(workspaceId: string): Record<string, CanvasTool> {
  const wsScope: CanvasConfigScope = { level: 'workspace', workspaceId };
  const globalScope: CanvasConfigScope = { level: 'global' };

  return {
    skill_save: {
      name: 'skill_save',
      defer_loading: true,
      description:
        'Persist a reusable skill as a SKILL.md. The agent should ONLY call ' +
        'this after the user has approved the draft name, description, and ' +
        'body in the conversation. Workspace scope (default) keeps the skill ' +
        'local to this canvas; global makes it available everywhere. ' +
        'Upserts by name — calling twice with the same name overwrites.',
      inputSchema: z.object({
        name: z
          .string()
          .describe('Short kebab-case identifier, e.g. "code-review" or "bug-trace".'),
        description: z
          .string()
          .describe(
            'One sentence telling the agent WHEN to load this skill ' +
              '(matched against future user queries).',
          ),
        body: z
          .string()
          .describe('Step-by-step Markdown instructions for the agent.'),
        scope: scopeArg,
      }),
      execute: async (input) => {
        const scope: CanvasConfigScope = input.scope === 'global' ? globalScope : wsScope;
        const status = await upsertCanvasSkill(scope, {
          name: input.name,
          description: input.description,
          body: input.body,
        });
        await refresh(scope);
        const saved = status.skills.find((s) => s.name === input.name);
        const path = saved?.path ?? `${scopeSkillsDir(scope)}/${skillSlug(input.name)}/SKILL.md`;
        const where = scope.level === 'global' ? 'global' : 'this workspace';
        return `Saved skill "${input.name}" to ${where} at ${path}. It is available on your next message.`;
      },
    },

    skill_promote: {
      name: 'skill_promote',
      defer_loading: true,
      description:
        'Move a workspace-scoped skill to global scope so every canvas can ' +
        'use it. The agent should ONLY call this after the user explicitly ' +
        'asks to promote a specific skill by name. Overwrites any global ' +
        'skill with the same name.',
      inputSchema: z.object({
        name: z.string().describe('Name of the workspace skill to promote.'),
      }),
      execute: async (input) => {
        try {
          const result = await promoteCanvasSkill(workspaceId, input.name);
          await refresh(globalScope);
          return `Promoted "${result.skill.name}" to global. Removed the workspace copy and refreshed all active canvases.`;
        } catch (error) {
          return `Error: ${error instanceof Error ? error.message : String(error)}`;
        }
      },
    },
  };
}
