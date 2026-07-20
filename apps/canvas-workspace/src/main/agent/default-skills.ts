/**
 * Seeds the bundled default skills.
 *
 * `save-as-skill` / `promote-skill` are meta-skills for in-chat skill
 * management; `suggest-tags` drives the "find which nodes should carry a tag"
 * advisory workflow. All three are plain SKILL.md files in
 * the global scope — the agent's behavior is defined by these (user-editable)
 * markdown files, not by hard-coded prompts. Each one leans on a companion
 * tool for the resulting action (`canvas_save_skill` / `canvas_promote_skill`
 * in `tools/skills.ts`); the SKILL.md tells the agent *when* and *how* to call it.
 *
 * On every app start we write them only if absent. The one obsolete bundled
 * default is upgraded by exact hash; user-edited variants keep their version.
 */

import { promises as fs } from 'fs';
import { createHash } from 'crypto';
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
    'When the user wants to find which nodes should carry a tag (e.g. 「帮我看看哪些节点可以打上 [AI]」 / "which notes should be tagged RAG?"), use this to scan local workspaces and return grounded suggestions without changing nodes.',
  body: `# suggest-tags

Use this when the user wants to **find which nodes should carry a tag**, **audit nodes that have no tags**, or **prepare tag changes across the canvas** — e.g. 「帮我看看哪些节点可以打上 [AI]」, "which notes should be tagged RAG?", 「哪些节点还没打标签?」.

Works in global chat (the whole system) and inside a single workspace. It is advisory only: return suggestions in chat and never mutate nodes or create review cards.

**Bias for precision over recall: a wrong tag is worse than a missed one.** Titles are loose (a shared word like "数据"/"平台"/"AI" is NOT a match) — judge from real content, and when unsure, leave it out.

## Steps

1. **Pin down the tag and its meaning.** Call \`canvas_list_tags\` for the exact name/id and the tag's **description** — that description is your rubric. If the tag is new, or its meaning is vague, ask the user one line about what it should cover BEFORE judging. (A new tag is created only if the user later applies a proposal.)
   - *Scope:* default all workspaces; pass a \`workspaceId\` (resolve via \`canvas_list_workspaces\`) only if the user scoped it.

2. **Shortlist (don't decide yet).** \`canvas_list_nodes({ untaggedOnly: true })\` — add \`query\` with the tag's keywords to keep the shortlist tight on a big canvas. Use \`title\` + \`summary\` ONLY to narrow down to plausible candidates; **do not tag based on the title/summary alone.**

3. **Read the full content before suggesting — mandatory.** For EVERY node you intend to suggest, call \`canvas_read_node({ workspaceId, nodeId })\` and judge from the **actual content**, not the title or snippet. Do not put a node in the result you haven't read.

4. **Judge strictly against the rubric.** Include a node only when its content is *substantively about* the tag's meaning (step 1's description) — i.e. the tag is a real subject/topic of the node, not a passing mention or an incidental keyword. When unsure, exclude it (or list it under a separate "maybe / 不确定" group); never auto-include to look thorough.

5. **Show the candidate list.** Group by workspace; each line = node title + a one-line reason **grounded in what you read** (e.g. "讲的是 X,属于…"). List the "maybes" separately. State clearly that these are suggestions only and no nodes were changed.

## Rules

- **Never mutate nodes or create review cards.** This workflow only reports suggestions in chat.
- **Precision first:** don't pad the list. If only 3 of 20 truly fit, propose 3.
- Reading full content costs tokens — keep the shortlist tight (use \`query\`) so you're not reading the whole canvas.
- If nothing clearly fits, say so instead of forcing low-confidence tags.
`,
};

const MEMORY_REVIEW: DefaultSkill = {
  slug: 'memory-review',
  name: 'memory-review',
  description:
    'When the user asks to review a period and distill it into long-term memory — e.g. "帮我盘点这周", "生成记忆周报/记忆报告", "review this week and update your memory" — use this to build the report and adopt only user-confirmed candidates.',
  body: `# memory-review

Build a period report from chat history, propose memory candidates, and persist ONLY what the user confirms.

## Steps

1. **Pin the period.** Default: last 7 days. Use the user's period if they named one.

2. **Gather (read-only).**
   - \`session_summary\` for that period — covers every workspace + global chat.
   - \`memory_list\` — existing entries are your dedupe rubric.
   - \`canvas_list_workspaces\` — id↔name mapping for scope labels and \`memory_adopt\`.

3. **Draft the report in chat:**
   - Per-workspace: 2-4 lines of what happened, decisions made, problems solved. Skip idle workspaces.
   - **Candidates**: a numbered list. Each = ONE distilled statement (≤500 chars) + suggested scope (全局 or workspace name) + kind (preference/fact/decision/rule/note).
   - Skip anything existing memory already covers; if a candidate supersedes an existing entry, mark it "更新: 替代 [mem-…]".
   - Precision over recall — propose 3 solid candidates over 10 weak ones. Transient task state is NOT a candidate.

4. **Wait for explicit confirmation.** The user picks numbers ("采纳 1、3"), edits wording, or rejects. Silence or "looks interesting" is NOT confirmation.

5. **Persist via \`memory_adopt\`** with only the approved candidates — \`workspaceId\` from step 2's mapping, omitted for 全局. If a confirmed candidate replaces a stale entry, \`memory_forget\` that entry's id afterwards.

6. **Report back**: what was written to which scope (ids), what was skipped.

## Rules

- **Never call \`memory_adopt\` without the user's explicit approval of those exact candidates in this conversation.**
- \`memory_adopt\` is the ONLY cross-workspace write path, and only for this flow; routine remembering stays on \`memory_save\`.
- Never copy raw transcript excerpts into a candidate — always distill to a standalone statement.
`,
};

const DEFAULT_SKILLS: DefaultSkill[] = [SAVE_AS_SKILL, PROMOTE_SKILL, SUGGEST_TAGS, MEMORY_REVIEW];

// Exact SHA-256 of the previously bundled suggest-tags SKILL.md. Updating only
// this byte-for-byte default migrates the obsolete direct-write workflow while
// preserving every user-edited variant.
const LEGACY_SUGGEST_TAGS_HASH =
  'aa96972edae3f969eaf408dfb1fa88d47bff03a96775146bed2ff5aa72430a3f';

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

function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

/**
 * Write the bundled meta-skills to `~/.pulse-coder/canvas/skills/<slug>/SKILL.md`
 * for any slug that doesn't already have a file. Safe to call repeatedly:
 * user edits are left untouched, while exact obsolete defaults may migrate.
 */
export async function ensureDefaultSkillsSeeded(): Promise<void> {
  const globalSkillsDir = scopeSkillsDir({ level: 'global' });
  for (const skill of DEFAULT_SKILLS) {
    const dir = join(globalSkillsDir, skill.slug);
    const file = join(dir, 'SKILL.md');
    try {
      const existing = await fs.readFile(file, 'utf8');
      const legacyHash = skill.slug === 'suggest-tags' ? LEGACY_SUGGEST_TAGS_HASH : undefined;
      const referencesRemovedProposalTool = skill.slug === 'suggest-tags'
        && existing.includes('canvas_propose_node_change');
      if ((legacyHash && sha256(existing) === legacyHash) || referencesRemovedProposalTool) {
        await fs.writeFile(file, serialize(skill), 'utf8');
        console.info(`[default-skills] upgraded bundled ${file}`);
      }
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
