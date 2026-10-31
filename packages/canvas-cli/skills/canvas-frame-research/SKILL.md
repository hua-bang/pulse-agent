---
name: canvas-frame-research
description: Extend an existing Pulse Canvas frame with local, source-backed research while preserving the surrounding canvas. Use when the user asks to research, enrich, expand, verify, update, or add sources/details inside a selected or named frame, rather than bootstrapping a whole new canvas.
canvas-agent: false
---

# Canvas Frame Research

Research within one existing frame and add layered information back into that frame. This skill is for local expansion, not whole-canvas generation.

This version is for agents that reach the canvas through the `pulse-canvas` CLI. The Canvas Agent inside Pulse Canvas has its own native-tool version of this skill.

## Core Contract

- Work inside one target frame.
- Do not create a new workspace.
- Do not reorganize the whole canvas.
- Do not move unrelated nodes outside the target frame.
- Do not create action, task, terminal, or agent nodes by default.
- Use the user's explicitly named research skill, tool, or workflow when provided.
- Otherwise use `canvas-deep-research` when available, or follow the same source-backed protocol directly.
- Use the user's language for questions, summaries, and node content unless requested otherwise.

## Phase 0: Resolve the Target Frame

Identify the target frame before researching:

1. If the user named a frame, resolve it by exact or near-exact title.
2. If the user named child nodes, infer their containing frame from the layout.
3. If multiple frames match, ask the user to choose.
4. If no frame can be identified, ask the user to name a frame. The CLI cannot see the user's selection.

Read the current frame context before planning:

- `pulse-canvas context --format json` for the workspace summary
- `pulse-canvas layout read --workspace <id> --format json` for frame bounds, children, and nearby nodes
- `pulse-canvas node read <nodeId> --format json` for the target frame and relevant child nodes
- `pulse-canvas edge list --format json` when relationships around the frame matter

## Phase 1: Local Research Contract

Decide the local intent:

- `fill_gaps`: add missing pieces implied by existing notes
- `add_sources`: add or improve source coverage
- `deepen`: add more detailed explanation under the same topic
- `compare`: add local comparison or contrast
- `verify`: check claims and mark confidence/conflicts
- `update`: refresh stale or current-state information

If the request is broad, current, or likely to create many nodes, ask for research depth. Translate this example into the user's language:

```text
这次只扩展当前 frame。请选择局部调研深度：
1. Quick - 补少量关键信息
2. Standard - 补完整一组结构化资料
3. Deep - 做更强来源验证和冲突检查
```

For a small obvious addition, default to `quick` and state the assumption briefly.

## Phase 2: Local Research

Use the target frame's existing content as context and boundary.

Research requirements:

- Reuse existing frame content before searching externally.
- Prefer primary and official sources for factual claims, APIs, specs, products, policies, and current behavior.
- Browse for current or unstable facts.
- Record source ids and keep them visible in created nodes.
- Separate sourced facts from inference.
- Surface conflicts, weak evidence, and open questions.
- Stop when the new findings no longer belong in the target frame.

If findings belong elsewhere, ask before creating a sibling frame or top-level cluster.

## Phase 3: Local Canvas Plan

Create a compact plan before mutating the canvas when the update is more than one or two nodes.

Default node budget:

- `quick`: 1-3 nodes
- `standard`: 3-6 nodes
- `deep`: 5-9 nodes, only when the frame can stay readable

Layer the information from shallow to deep:

- Overview layer: one short summary or "what changed" note when useful.
- Structure layer: shapes or small structural notes for categories, comparison axes, timelines, or relationships.
- Detail layer: note or file nodes for deeper analysis.
- Source layer: source or web nodes when available; otherwise source-summary notes.
- Open-question layer: note nodes for unresolved claims, conflicts, or weak evidence.
- Action layer: omit by default. Let the user add follow-up tasks later unless explicitly requested.

## Phase 4: Create Local Nodes

1. Create new nodes inside the target frame's bounds (read them from `layout read`), then let `layout frame-grid` settle the positions:

```bash
pulse-canvas node create --workspace <id> --type file --title "<node>" --x <x> --y <y> --data '{"content":"..."}' --format json
```

2. Use note/file nodes with visible source ids for sources.
3. Connect only meaningful local relationships with `pulse-canvas edge create --workspace <id> --from <nodeId> --to <nodeId> --label "<label>" --format json`.
4. Avoid duplicating existing child nodes. Update or extend an existing node when that is cleaner.
5. Run all mutations sequentially and pass `--workspace <id>` on every one.

## Phase 5: Layout Only the Frame

After creating or updating nodes, arrange only the target frame (run the two commands sequentially, like all mutations):

```bash
pulse-canvas layout frame-grid --workspace <id> --frame <target-frame-id> --format json
pulse-canvas layout validate --workspace <id> --format json
```

Move individual nodes with `node update` if validation flags them. Do not reorganize frames outside the target frame unless the user explicitly asks to reorganize the larger canvas.

## Phase 6: Summarize

Tell the user:

- what was added or updated
- which sources support the new claims
- what remains uncertain
- whether anything should become a new sibling frame instead of staying local

## Quality Rules

1. Target frame is resolved before research starts.
2. Existing frame content is read before adding new content.
3. New nodes remain relevant to the target frame.
4. Source ids are visible on factual claims.
5. Action-oriented nodes are opt-in, not default.
6. Layout is local to the target frame.
7. If the frame becomes crowded, suggest splitting into a sibling frame instead of forcing more nodes inside.
