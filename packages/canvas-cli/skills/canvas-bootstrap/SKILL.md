---
name: canvas-bootstrap
description: Deep-research a topic and build a structured Pulse Canvas workspace with approved research depth, source-backed findings, progressive or final canvas creation, spatially organized frames, content nodes, and connections. Use when the user asks to bootstrap, generate, research, organize, or build an AI-created canvas.
---

# Canvas Bootstrap

Turn a topic into a source-backed Pulse Canvas workspace. This skill is an orchestrator: use a user-approved research skill or the bundled `canvas-deep-research` protocol for evidence gathering, then use canvas layout tools for geometry.

## Core Contract

- Ask for research depth first unless the user already provided it.
- After depth is chosen, show a research plan and wait for user modification or approval.
- Do not start substantial research before the plan is approved.
- Do not create canvas nodes before approval. Optional live-board creation also requires approval.
- If the user explicitly names a different Deep Research skill, tool, or workflow, use that approved research capability for evidence gathering.
- Otherwise use `canvas-deep-research` when available. If it is unavailable, follow the same source-backed protocol directly.
- Keep content and layout separate: research determines what belongs on the canvas; layout tools determine where it goes.
- Use the user's language for user-facing questions, plans, summaries, and node content unless the user requests otherwise.
- If the user asks to expand, enrich, verify, or research inside an existing frame, use `canvas-frame-research` instead of this whole-canvas bootstrap flow.

## Phase 0: Depth Gate

If the user did not explicitly choose a depth, ask a short question and stop:

```text
请选择这次调研深度：
1. Quick - 快速扫一遍，适合方向判断
2. Standard - 标准调研，适合生成一张可靠画布
3. Deep - 深度调研，适合高质量信息源、交叉验证和风险判断

如果有范围限制，比如地区、时间、竞品、技术栈，也可以一起补充。
```

Depth behavior:

- `quick`: fewer passes, concise canvas, usually 2-4 frames.
- `standard`: default for most canvas bootstraps, usually 3-6 frames.
- `deep`: multiple passes with stronger source checks, contradictions, risks, and open questions.

## Phase 1: Plan Approval Gate

After the user chooses depth, draft the overall plan and ask for approval before research.

The plan must include:

- research objective and boundary
- research questions
- source strategy and expected source types
- planned research passes
- planned information layers, such as overview, structure, details, sources, and open questions
- likely canvas structure, such as provisional frame names
- proposed output mode:
  - `plan-first`: research fully first, then create the final canvas
  - `live-board`: after approval, create a draft research board and update it during research
- what will count as "done"

End the plan with a clear approval request, for example:

```text
你可以直接回复“批准开始”，也可以修改调研问题、范围、深度或画布模式。
```

Do not browse, run long local scans, or create nodes while waiting for approval.

## Phase 2: Deep Research Execution

After approval, use the research capability chosen in the approved plan.

Research skill selection order:

1. User-explicit research skill, tool, or workflow, if named and available.
2. Bundled `canvas-deep-research`.
3. The source-backed protocol below, followed directly.

If the runtime does not auto-load the bundled skill, load the `canvas-deep-research` skill by name before researching.

Research requirements:

- Prefer primary and official sources for facts, APIs, specs, company claims, pricing, policies, and current product behavior.
- Use credible secondary sources to understand interpretation, market context, criticism, or adoption.
- Browse for current or unstable facts.
- Record a source ledger with source id, title, publisher, date, URL or path, source type, and relevance.
- Cross-check important claims before turning them into canvas content.
- Label inference, weak evidence, conflicts, and unresolved questions.
- Produce a `research_brief` compatible with the chosen research skill's output contract, or with `canvas-deep-research` when using the bundled protocol.

For `deep`, run multiple passes, for example:

1. primary source pass
2. landscape and current-state pass
3. technical or operational detail pass
4. risks, contradictions, and counterexamples pass
5. synthesis and canvas handoff pass

## Phase 3: Optional Live Research Board

Use this only when the approved plan chooses `live-board`.

Create a draft workspace or draft area after approval, then update it during research. Recommended draft frames:

- `Research Plan`
- `Source Queue`
- `Sources Read`
- `Findings Drafts`
- `Open Questions`
- `Final Synthesis`

Live-board rules:

- Mark draft nodes clearly.
- Add source nodes or source summaries as they are reviewed.
- Move findings from draft to synthesis only after cross-checking.
- Keep live updates compact; do not flood the canvas with every search result.
- Use `region_grid` to tidy the active draft area without moving unrelated nodes.
- Run final layout after synthesis, not after every small update.

If canvas tools are unavailable, report progress conversationally and create the canvas only when tools become available.

## Phase 4: Synthesize Canvas Plan

Convert the research brief into a canvas plan.

Planning rules:

- Each frame is one logical category from the research, not a fixed template.
- Aim for 3-6 frames for most topics.
- Each frame should have 2-4 substantial content nodes.
- Merge frames with only one weak node.
- Split frames with more than four substantial nodes.
- Each content node should contain real synthesized content, not placeholders.
- Put source ids inside node content so claims remain traceable.
- Build the canvas as layered information, moving from overview to structure to details.
- Do not create action, task, terminal, or agent nodes by default. Only add them when the user explicitly asks for execution or follow-up work to be placed on the canvas.
- Create 2-5 meaningful edges between frames or major nodes.

If research materially changes the approved plan, show the changed structure and ask for a quick confirmation before final creation.

Node type strategy:

- Overview layer: use summary-style note nodes for the research question, key conclusions, reading path, and strongest takeaways.
- Structure layer: use frames, shapes, and edges to show categories, comparisons, timelines, dependencies, tensions, and hierarchy.
- Detail layer: use note or file nodes for deeper explanations, evidence, assumptions, and per-topic analysis.
- Source layer: use source or web nodes when available; otherwise use source-summary note nodes. Keep source ids visible.
- Open-question layer: use note nodes for unresolved questions, conflicts, weak evidence, and areas that need future human judgment.
- Action layer: omit by default. Leave follow-up tasks for the user to add later unless explicitly requested.

## Phase 5: Create Canvas Content

Preferred path inside Canvas Agent runtime:

1. Call `canvas_read_layout` before creating or arranging content in an existing workspace.
2. Create frames and nodes with canvas creation tools.
3. For single semantic insertions, use `placement` instead of raw coordinates:
   - `append_canvas` for a new top-level cluster
   - `near_node` for a finding derived from a source or existing node
   - `inside_frame` for content that belongs in a known frame
   - `at` only when the user gave a precise location
4. Create sparse edges with `canvas_create_edge`.

Fallback path outside Canvas Agent runtime:

```bash
pulse-canvas workspace create "<topic>" --format json
pulse-canvas node create --type frame --title "<frame>" --format json
pulse-canvas node create --type file --title "<node>" --data '{"content":"..."}' --format json
pulse-canvas edge create --from <nodeId> --to <nodeId> --label "<label>" --kind flow --format json
```

Use fallback coordinates only when no layout tool is available.

## Phase 6: Apply Layout

Preferred layout path:

1. For each final frame, arrange its children:

```text
canvas_apply_layout({ mode: "frame_grid", frameId: "<frame-id>", fitFrame: true })
```

2. Arrange top-level frames and standalone nodes:

```text
canvas_apply_layout({ mode: "canvas_grid", nodeIds: ["<frame-id>", "..."], respectLayoutLocked: true })
```

3. For a selected area or live-board draft area:

```text
canvas_apply_layout({ mode: "region_grid", nodeIds: ["<node-id>", "..."] })
```

4. Validate the result:

```text
canvas_apply_layout({ mode: "validate" })
```

If validation reports overlaps or out-of-frame nodes, fix the relevant frame or region with `frame_grid` or `region_grid`, then validate again.

Manual fallback layout:

- Start at `(50, 50)`.
- Use frame padding `24`.
- Use frame gap `100` or more so floating frame titles remain visible.
- Use file node size around `300 x 360`.
- Put 1-3 child nodes in one row, 4 child nodes as a `2 x 2` grid.
- Wrap frames to a new row when the row would exceed roughly `1500px`.

## Phase 7: Verify and Summarize

Before final response:

- Read or validate the final canvas layout.
- Confirm every final frame has useful content.
- Confirm important findings have source ids.
- Confirm edges are sparse and meaningful.
- Summarize the created frames, key findings, source quality, unresolved questions, and any layout caveats.

## Frame Colors

| Purpose | Hex |
|---------|-----|
| Overview / Summary | `#5594e8` |
| Research / Analysis | `#9575d4` |
| Contrasts / Tradeoffs | `#e8615a` |
| Implementation | `#3eb889` |
| Notes / Decisions | `#e89545` |
| Data / Metrics | `#35aec2` |
| Risks / Open Questions | `#d66aa3` |

## Quality Rules

1. Approval comes before research execution and canvas mutation.
2. Research findings cite source ids.
3. Draft live-board content is clearly marked as draft.
4. Final content is synthesized and actionable, not copied source fragments.
5. Frames contain 2-4 substantial nodes unless the topic strongly justifies otherwise.
6. Layout tools are the default for geometry; manual coordinates are fallback only.
7. Existing unrelated nodes are not moved unless the user approved an organizing action.
8. Edges explain relationships with short labels and meaningful kinds.
9. Uncertainty, conflicts, and open questions remain visible in the canvas.
10. The final canvas focuses on information organization. Action-oriented nodes are opt-in, not default.
