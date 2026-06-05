/**
 * Seeds the bundled default skills.
 *
 * `save-as-skill` / `promote-skill` are meta-skills for in-chat skill
 * management; `suggest-tags` drives the "find which nodes should carry a tag,
 * then batch-apply it" workflow. All three are plain SKILL.md files in the
 * global scope — the agent's behavior is defined by these (user-editable)
 * markdown files, not by hard-coded prompts. Each one leans on a companion
 * tool for the actual write (`canvas_save_skill` / `canvas_promote_skill` in
 * `tools/skills.ts`, `canvas_tag_node` in `tools/tagging.ts`); the SKILL.md
 * tells the agent *when* and *how* to call it.
 *
 * On every app start we write them only if absent, so a user who edited one
 * to taste keeps their version.
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

const SUGGEST_TAGS: DefaultSkill = {
  slug: 'suggest-tags',
  name: 'suggest-tags',
  description:
    'When the user wants to find which nodes should carry a tag (e.g. 「帮我看看哪些节点可以打上 [AI]」 / "which notes should be tagged RAG?"), audit nodes that are missing tags, or batch-apply a tag across the canvas — use this to scan the local workspaces, propose candidates, confirm with the user, then apply with canvas_tag_node.',
  body: `# suggest-tags

Use this when the user wants to **find which nodes should carry a tag**, **audit nodes that have no tags**, or **apply a tag across the canvas** — e.g. 「帮我看看哪些节点可以打上 [AI]」, "which notes should be tagged RAG?", 「哪些节点还没打标签?」.

Works in global chat (the whole system) and inside a single workspace. It only touches knowledge-layer tags — never the canvas layout.

## Steps

1. **Pin down the tag and the scope.**
   - *Which tag?* If the user named one (e.g. \`[AI]\`), use it. Call \`canvas_list_tags\` to see what already exists and the exact name/id; if the tag is new, note that it will be created on first apply.
   - *Which scope?* Default to **all workspaces**. If the user pointed at one canvas, pass its \`workspaceId\` — use \`canvas_list_workspaces\` to resolve a name → id when needed.

2. **Gather candidates with \`canvas_list_nodes\`.**
   - "Which nodes fit tag X" → start from \`canvas_list_nodes({ untaggedOnly: true })\` (add \`query\` if the user gave a keyword). Re-tagging already-tagged nodes only when the user asks.
   - "Which nodes are missing tags" → \`canvas_list_nodes({ untaggedOnly: true })\`, optionally scoped to one \`workspaceId\`.
   - Each row gives a node's \`title\`, current \`tags\`, and a short \`summary\`. For anything you can't judge from the title/summary, read it with \`canvas_read_node({ workspaceId, nodeId })\` first — but only the unsure ones, don't pull every node's full content.

3. **Decide conservatively.** Propose a node only when it clearly matches the tag's meaning. When unsure, leave it out and list it as a "maybe" rather than tagging it.

4. **Show the proposal and get confirmation.** Present a scannable list grouped by workspace — each line = node title + a one-line reason. End with a question like 「这些打上 [AI] 吗?要去掉哪几个?」. **Do not tag yet.**

5. **Apply in ONE batch.** After the user confirms (and any edits), call \`canvas_tag_node\` once. Put the tag **once at the top level** in \`addTags\` and leave the per-node objects to just \`{ nodeId, workspaceId }\`:
   \`\`\`json
   {
     "nodes": [{ "nodeId": "<id>", "workspaceId": "<wsId>" }],
     "addTags": ["AI"]
   }
   \`\`\`
   - Use the EXACT \`nodeId\` / \`workspaceId\` from \`canvas_list_nodes\` — never guess from titles.
   - Do NOT put \`addTags\` / \`setTags\` on each node, and never pass empty arrays (\`[]\`) — empty arrays are ignored and just add noise. Only set a per-node tag field when that node genuinely needs a different tag.
   - After the call, read the result's \`changed\` count and each node's \`changed\` flag — \`ok:true\` alone does NOT mean a tag was applied (a node can be unchanged). Report the real \`changed\` number and surface any per-node errors / notes.

## Rules

- **Never call \`canvas_tag_node\` without explicit confirmation** in the conversation. 「打吧」/「ok」 counts; silence does not.
- **Propose first, apply on the next turn** — don't scan-and-tag in the same breath the user asked.
- Prefer **one** \`canvas_tag_node\` call with the whole batch over many single calls.
- \`addTags\` merges (keeps a node's existing tags). Only reach for \`setTags\` / \`removeTags\` when the user explicitly wants to replace or strip tags.
- If nothing clearly fits, say so instead of forcing low-confidence tags.
`,
};

const DEFAULT_SKILLS: DefaultSkill[] = [SAVE_AS_SKILL, PROMOTE_SKILL, SUGGEST_TAGS];

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
