/**
 * Seeds the two meta-skills that drive in-chat skill management.
 *
 * `save-as-skill` and `promote-skill` are themselves SKILL.md files in the
 * global scope — the agent's behavior when a user says "save this as a
 * skill" or "promote it to global" is entirely defined by these
 * (user-editable) markdown files, not by hard-coded prompts.
 *
 * On every app start we write them only if absent, so a user who edited
 * either one to taste keeps their version. The companion `canvas_save_skill`
 * / `canvas_promote_skill` tools (see `tools/skills.ts`) provide the actual
 * write capability; the SKILL.md tells the agent *when* to call them.
 */

import { promises as fs } from 'fs';
import { join } from 'path';
import { scopeSkillsDir } from './config-scope';

interface DefaultSkill {
  slug: string;
  name: string;
  description: string;
  body: string;
}

const SAVE_AS_SKILL: DefaultSkill = {
  slug: 'save-as-skill',
  name: 'save-as-skill',
  description:
    'When the user asks to save the current conversation (or part of it) as a reusable skill — e.g. "save this as a skill", "把这个流程沉淀成 skill" — follow the steps below to draft, confirm with the user, and persist it.',
  body: `# save-as-skill

Use this when the user explicitly asks to turn what just happened in the conversation into a reusable skill.

## Steps

1. **Decide the scope of the source material.** If the user named a specific stretch ("the last bug-fix", "from when we started debugging login"), use that. Otherwise default to the most recent coherent task — usually the last 3–10 turns. If unclear, ask the user briefly.

2. **Draft three fields:**
   - **name** — short kebab-case identifier (e.g. \`code-review\`, \`bug-trace\`). Specific over generic.
   - **description** — ONE sentence telling future-you (the agent) *when* to load this skill. Phrased like "When the user … use this to …". This is what gets matched against future user queries, so make it concrete.
   - **body** — Markdown step-by-step instructions. Distill what *actually worked* in the conversation, not a textbook procedure. Reference specific tools, file patterns, or commands you used.

3. **Pick a scope:** default to \`workspace\` (this canvas only). Switch to \`global\` only if the user says so, or if the skill is obviously generic (e.g. nothing workspace-specific in the body).

4. **Show the draft to the user** as a chat message — all three fields plus the chosen scope. End with a question like "保存吗?要改哪里?" so they can adjust the name, edit a step, change scope, or cancel.

5. **Apply their edits**, then call the \`canvas_save_skill\` tool with the final \`{ name, description, body, scope }\`. Confirm the path it landed at.

## Rules

- **Never call \`canvas_save_skill\` without explicit user confirmation in the conversation.** A "looks good" or "保存吧" counts; silence does not.
- **Don't auto-save in the same turn the user asked.** Always show the draft first, then save on the next turn.
- If the user pushes back ("no, drop step 3", "rename to foo"), apply the change and re-show the draft before saving.
- If the conversation didn't actually accomplish anything useful (just exploration, no concrete steps that worked), say so and suggest the user invoke this later when there's something concrete to save.
`,
};

const PROMOTE_SKILL: DefaultSkill = {
  slug: 'promote-skill',
  name: 'promote-skill',
  description:
    'When the user asks to promote a workspace-scoped skill to global so every canvas can use it — e.g. "promote login-trace to global", "把 foo skill 提升到全局" — follow these steps.',
  body: `# promote-skill

Use this when the user wants a workspace-only skill to be available across every canvas.

## Steps

1. **Identify the target skill by name.** If the user didn't name it, ask. If multiple skills could match, list candidates and ask.

2. **Quickly check the skill body for workspace-specific content** (hard-coded paths, project names, team URLs). If you see any, flag it: "这条里有 \`/Users/.../auth-server\` 这种本地路径,提升到全局后在别的 workspace 跑会怪。要不要先编辑一下?" Wait for the user's decision before continuing.

3. **Warn if a global skill with the same name already exists** — promoting overwrites it. Confirm before proceeding.

4. **Call \`canvas_promote_skill\` with \`{ name }\`.** The tool moves the file from the workspace's skills dir to the global one and removes the workspace copy. Confirm the result.
`,
};

const DEFAULT_SKILLS: DefaultSkill[] = [SAVE_AS_SKILL, PROMOTE_SKILL];

function serialize(skill: DefaultSkill): string {
  return [
    '---',
    `name: ${JSON.stringify(skill.name)}`,
    `description: ${JSON.stringify(skill.description)}`,
    '---',
    '',
    skill.body.replace(/\s+$/, ''),
    '',
  ].join('\n');
}

/**
 * Write the bundled meta-skills to `~/.pulse-coder/canvas/skills/<slug>/SKILL.md`
 * for any slug that doesn't already have a file. Safe to call repeatedly:
 * existing files (including user edits) are left untouched.
 */
export async function ensureDefaultSkillsSeeded(): Promise<void> {
  const globalSkillsDir = scopeSkillsDir({ level: 'global' });
  for (const skill of DEFAULT_SKILLS) {
    const dir = join(globalSkillsDir, skill.slug);
    const file = join(dir, 'SKILL.md');
    try {
      await fs.access(file);
      // Already present (possibly user-edited) — leave it alone.
      continue;
    } catch {
      // Missing — fall through to write the default.
    }
    try {
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(file, serialize(skill), 'utf8');
      console.info(`[default-skills] seeded ${file}`);
    } catch (err) {
      console.warn(`[default-skills] failed to seed ${file}:`, err);
    }
  }
}
