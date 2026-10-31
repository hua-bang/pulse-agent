---
name: "save-as-skill"
description: "When the user asks to save the current conversation (or part of it) as a reusable skill — e.g. \"save this as a skill\", \"把这个流程沉淀成 skill\" — follow the steps below to draft, confirm with the user, and persist it."
---

# save-as-skill

Use this when the user explicitly asks to turn what just happened in the conversation into a reusable skill.

## Steps

1. **Decide the scope of the source material.** If the user named a specific stretch ("the last bug-fix", "from when we started debugging login"), use that. Otherwise default to the most recent coherent task — usually the last 3–10 turns. If unclear, ask the user briefly.

2. **Draft three fields:**
   - **name** — short kebab-case identifier (e.g. `code-review`, `bug-trace`). Specific over generic.
   - **description** — ONE sentence telling future-you (the agent) *when* to load this skill. Phrased like "When the user … use this to …". This is what gets matched against future user queries, so make it concrete.
   - **body** — Markdown step-by-step instructions. Distill what *actually worked* in the conversation, not a textbook procedure. Reference specific tools, file patterns, or commands you used.

3. **Pick a scope:** default to `workspace` (this canvas only). Switch to `global` only if the user says so, or if the skill is obviously generic (e.g. nothing workspace-specific in the body).

4. **Show the draft to the user** as a chat message — all three fields plus the chosen scope. End with a question like "保存吗?要改哪里?" so they can adjust the name, edit a step, change scope, or cancel.

5. **Apply their edits**, then call the `skill_save` tool with the final `{ name, description, body, scope }`. Confirm the path it landed at.

## Rules

- **Never call `skill_save` without explicit user confirmation in the conversation.** A "looks good" or "保存吧" counts; silence does not.
- **Don't auto-save in the same turn the user asked.** Always show the draft first, then save on the next turn.
- If the user pushes back ("no, drop step 3", "rename to foo"), apply the change and re-show the draft before saving.
- If the conversation didn't actually accomplish anything useful (just exploration, no concrete steps that worked), say so and suggest the user invoke this later when there's something concrete to save.
