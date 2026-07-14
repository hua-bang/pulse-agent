---
name: "suggest-tags"
description: "When the user wants to find which nodes should carry a tag (e.g. 「帮我看看哪些节点可以打上 [AI]」 / \"which notes should be tagged RAG?\"), audit nodes that are missing tags, or batch-apply a tag across the canvas — use this to scan the local workspaces, propose candidates, confirm with the user, then apply with canvas_tag_node."
---

# suggest-tags

Use this when the user wants to **find which nodes should carry a tag**, **audit nodes that have no tags**, or **apply a tag across the canvas** — e.g. 「帮我看看哪些节点可以打上 [AI]」, "which notes should be tagged RAG?", 「哪些节点还没打标签?」.

Works in global chat (the whole system) and inside a single workspace. It only touches knowledge-layer tags — never the canvas layout.

**Bias for precision over recall: a wrong tag is worse than a missed one.** Titles are loose (a shared word like "数据"/"平台"/"AI" is NOT a match) — judge from real content, and when unsure, leave it out.

## Steps

1. **Pin down the tag and its meaning.** Call `canvas_list_tags` for the exact name/id and the tag's **description** — that description is your rubric. If the tag is new, or its meaning is vague, ask the user one line about what it should cover BEFORE judging. (Tag is created on first apply if new.)
   - *Scope:* default all workspaces; pass a `workspaceId` (resolve via `canvas_list_workspaces`) only if the user scoped it.

2. **Shortlist (don't decide yet).** `canvas_list_nodes({ untaggedOnly: true })` — add `query` with the tag's keywords to keep the shortlist tight on a big canvas. Use `title` + `summary` ONLY to narrow down to plausible candidates; **do not tag based on the title/summary alone.**

3. **Read the full content before proposing — mandatory.** For EVERY node you intend to propose, call `canvas_read_node({ workspaceId, nodeId })` and judge from the **actual content**, not the title or snippet. Do not put a node in the proposal you haven't read.

4. **Judge strictly against the rubric.** Include a node only when its content is *substantively about* the tag's meaning (step 1's description) — i.e. the tag is a real subject/topic of the node, not a passing mention or an incidental keyword. When unsure, exclude it (or list it under a separate "maybe / 不确定" group); never auto-include to look thorough.

5. **Show the proposal and get confirmation.** Group by workspace; each line = node title + a one-line reason **grounded in what you read** (e.g. "讲的是 X,属于…"). List the "maybes" separately. End with 「这些打上 [AI] 吗?要去掉哪几个?」. **Do not tag yet.**

6. **Apply in ONE batch.** After the user confirms (and any edits), call `canvas_tag_node` once. Put the tag **once at the top level** in `addTags`; leave each node object as just `{ nodeId, workspaceId }`:
   ```json
   {
     "nodes": [{ "nodeId": "<id>", "workspaceId": "<wsId>" }],
     "addTags": ["AI"]
   }
   ```
   - Use the EXACT `nodeId` / `workspaceId` from `canvas_list_nodes` — never guess from titles.
   - Do NOT put `addTags` / `setTags` on each node, and never pass empty arrays (`[]`) — empty arrays are ignored and just add noise. Only set a per-node tag field when that node genuinely needs a different tag.
   - After the call, read the result's `changed` count and each node's `changed` flag — `ok:true` alone does NOT mean a tag was applied (a node can be unchanged). Report the real `changed` number and surface any per-node errors / notes.

## Rules

- **Never call `canvas_tag_node` without explicit confirmation** in the conversation. 「打吧」/「ok」 counts; silence does not.
- **Propose first, apply on the next turn** — don't scan-and-tag in the same breath the user asked.
- **Precision first:** don't pad the list. If only 3 of 20 truly fit, propose 3.
- Reading full content costs tokens — keep the shortlist tight (use `query`) so you're not reading the whole canvas.
- Prefer **one** `canvas_tag_node` call with the whole batch. `addTags` merges; only reach for `setTags` / `removeTags` / `clearTags` when the user explicitly wants to replace, strip, or clear.
- If nothing clearly fits, say so instead of forcing low-confidence tags.
