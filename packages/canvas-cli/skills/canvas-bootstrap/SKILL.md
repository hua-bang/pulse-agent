---
name: canvas-bootstrap
description: Build or reorganize a structured Pulse Canvas workspace. Use create mode when the user asks to bootstrap, generate, research, or build an AI-created canvas with source-backed findings. Use organize-existing mode when the user asks to tidy,整理,重排,归类,优化布局, improve readability, or organize an existing whole canvas without adding new research.
---

# Canvas Bootstrap and Organization

Create a source-backed Pulse Canvas workspace or organize an existing whole canvas. In create mode, orchestrate approved research and layout. In organize-existing mode, preserve content and improve information architecture and geometry.

## Choose the Mode

- `create`: the user wants a new research-backed canvas or substantial new content. Follow Phases 0-7.
- `organize-existing`: the user wants existing canvas content grouped, renamed, resized, connected, or laid out more clearly. Follow **Organize an Existing Canvas**, then Phase 6 and Phase 7.
- `frame-research`: the user wants to enrich or verify one existing frame. Use `canvas-frame-research` instead.

Do not make an organize-only request pass through the research depth gate.

## Core Contract

- In `create` mode, ask for research depth first unless the user already provided it.
- After depth is chosen, show a research plan and wait for user modification or approval.
- Do not start substantial research before the plan is approved.
- Do not create canvas nodes before approval. Optional live-board creation also requires approval.
- If the user explicitly names a different Deep Research skill, tool, or workflow, use that approved research capability for evidence gathering.
- Otherwise use `canvas-deep-research` when available. If it is unavailable, follow the same source-backed protocol directly.
- Keep content and layout separate: research determines what belongs on the canvas; layout tools determine where it goes.
- Use the user's language for user-facing questions, plans, summaries, and node content unless the user requests otherwise.
- If the user asks to expand, enrich, verify, or research inside an existing frame, use `canvas-frame-research` instead of this whole-canvas bootstrap flow.

## Organize an Existing Canvas

Use this flow for `organize-existing` mode. Do not browse or add research unless the user separately asks for it.

### 1. Read Before Moving

Resolve the current or named workspace, then inspect:

```bash
'/Users/jasperhu/.pulse-coder/bin/pulse-canvas' context --workspace <id> --format json
'/Users/jasperhu/.pulse-coder/bin/pulse-canvas' layout read --workspace <id> --format json
'/Users/jasperhu/.pulse-coder/bin/pulse-canvas' edge list --workspace <id> --format json
```

Build an inventory of:

- frames and geometric membership
- unframed or ambiguously framed nodes
- node titles, types, dimensions, and content density
- overlaps, straddling, overflow, extreme whitespace, and narrow cards
- existing connections and long crossing edges
- visual hierarchy, source/reference material, and likely reading path

Treat frame membership as spatial, not only semantic. Do not assume a nearby card belongs in a frame when its content is ambiguous.

### 2. Diagnose the Board

Separate problems into three layers:

- **information architecture**: unclear groups, weak or generic frame names, duplicated categories, missing overview, scattered sources
- **editorial shape**: article-sized cards, vague titles, multiple claims per card, no visible thesis or conclusion
- **geometry**: overlaps, inconsistent gaps, uniform card sizing, stretched frames, edge crossings, poor Fit-view aspect ratio

Default to geometry and grouping changes only. Preserve node ids, card wording, rich-text marks, links, and existing evidence. Rewriting, splitting, merging, deleting, or creating cards requires explicit approval.

### 3. Propose the Reorganization

For more than a trivial move, present a compact plan before mutation:

- frames to retain, rename, merge, split, or create
- cards that will move between frames
- representation changes, such as a mindmap overview, HTML comparison, or image evidence
- size hierarchy for thesis, evidence, annotation, and source cards
- edge changes, if any
- items intentionally left untouched

Call out ambiguous cards separately. Ask for approval before moving unrelated existing nodes or changing editorial content.

### 4. Choose the Representation

Keep file cards as the default for atomic claims and searchable, editable prose. Introduce richer node types only when the representation materially improves understanding:

- **Mindmap**: use for a true hierarchy, taxonomy, decomposition, or branching question. It is especially useful as a collapsible overview that links to detailed cards. Do not force timelines, debates, or many-to-many relationships into a tree.
- **HTML/iframe**: use as an interactive explanation when manipulating a concept helps the reader understand causality, relationships, trade-offs, sequence, scale, or counterfactual outcomes. Good forms include parameter-driven models, step-through processes, explorable diagrams, comparison controls, and timeline scrubbing. A dashboard qualifies only when its interaction teaches something; static metric display does not. Keep it self-contained and pair it with a short searchable note containing the main conclusion. Do not turn ordinary prose into a miniature website.
- **Image**: use for diagrams, photographs, scanned evidence, source screenshots, or generated visual explanations. Add a descriptive title/alt text and visible provenance. Never rasterize editable text merely to make the board look polished.
- **Frames + cards + edges**: retain for spatial arguments, evidence maps, workflows, and non-hierarchical relationships.

Prefer a hybrid board when useful: a mindmap as the overview, file cards for evidence and explanation, one HTML node for interactive understanding, and images for visual source material.

Every HTML node must have an explicit learning contract:

- the question or concept the interaction should clarify
- controls that map to meaningful conceptual variables
- immediate visual feedback that exposes what changed and why
- a useful default state and short in-node guidance
- a nearby searchable card summarizing the durable takeaway

Representation changes are content-shape changes. In organize-existing mode, do not replace or delete the original cards until the user approves the conversion and the new representation has been verified.

Creation path:

- Create mindmaps through `canvas_create_node` or the CLI `mindmap` node type.
- Create HTML through Canvas runtime `canvas_create_node` with `type: "iframe"` and `data.mode: "html"`, or create an HTML artifact and pin it to the canvas.
- Create images through `canvas_create_node` with an absolute `data.filePath`, `canvas_generate_image`, or image paste/import.
- The external Canvas CLI cannot generically create app-produced iframe or image nodes. Do not invent a CLI fallback; use the live Canvas runtime or keep a file-card placeholder with the intended representation clearly marked.

### 5. Apply Safely

- Prefer one atomic `apply` plan with `baseRevision` for node moves/resizes and edge changes.
- Run `--dry-run` before the real apply.
- Run all mutations sequentially and pin `--workspace <id>`.
- Use `layout frame-grid` only after the intended children of a frame are settled.
- Arrange top-level frames manually into a readable overview; do not force every board into the same grid.
- Keep source/reference cards on the right or bottom periphery.
- Use at most three accent frame colors; keep auxiliary frames neutral.
- Prefer short local edges. Preserve meaningful existing labels.

### 6. Validate Preservation

Before and after counts must match for organize-only work unless the approved plan explicitly changes them:

- node count
- edge count
- frame count
- titled-card count
- rich-text/color-bearing card count when available

Run `layout validate`, inspect Fit view, and read representative cards at 100%. If the board is technically valid but the reading path remains unclear, revise the top-level frame arrangement instead of shrinking everything further.

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
- Use `pulse-canvas layout frame-grid --frame <draft-frame-id>` to tidy the active draft frame without moving unrelated nodes.
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

Editorial rules — these are what make the board read as a knowledge map
instead of a data dump. Apply them while planning; verify them in Phase 7:

- **One claim per card.** Title = a single assertion sentence; body = 2-5
  short support bullets. A card is not an article — move long-form prose
  into a separate detail card and link it with an edge, so the first view
  stays scannable.
- **Card budget.** Deep topics should land around 25-35 atomic cards total.
  If synthesis produces more, merge cards or push depth into linked detail
  cards instead of widening the first view.
- **Size encodes importance.** Thesis/conclusion cards widest (~460-520px),
  evidence cards default (~320-380px), side annotations smaller. Never make
  every card the same size — uniform sizing erases the argument's shape.
- **Sources live on the periphery.** Source/reference cards go to the right
  or bottom edge of the board, outside the main narrative flow — never
  interleaved with claim cards.
- **Highlight budget.** Colored emphasis (colored phrases, tinted cards)
  belongs on at most ~20% of cards — reserve it for load-bearing claims.
  Uniform emphasis reads as none.
- **Hue budget.** At most 3 accent-colored frames per board; every other
  frame (sources and auxiliary material always included) stays neutral
  graphite. The restraint is what makes the accents anchor — see Frame
  Colors below.
- **Edges are local relations, not long-haul wiring.** Prefer short edges
  between neighboring cards and frames, give curves a small `bend` so they
  read organically, and avoid edges that cross multiple frames.

If research materially changes the approved plan, show the changed structure and ask for a quick confirmation before final creation.

Node type strategy:

- Overview layer: use summary-style note nodes for the research question, key conclusions, reading path, and strongest takeaways.
- Hierarchy layer: use a mindmap when the content is genuinely tree-shaped and benefits from collapse/expand navigation.
- Structure layer: use frames, shapes, and edges to show categories, comparisons, timelines, dependencies, tensions, and hierarchy.
- Detail layer: use note or file nodes for deeper explanations, evidence, assumptions, and per-topic analysis.
- Interactive-understanding layer: use one or a small number of HTML/iframe nodes for explorable models, simulations, step-through explanations, counterfactuals, or relationship discovery; keep ordinary prose and durable conclusions in file cards.
- Image layer: use image nodes for diagrams, photos, visual evidence, and generated explanations, with descriptive titles and provenance.
- Source layer: use source or web nodes when available; otherwise use source-summary note nodes. Keep source ids visible.
- Open-question layer: use note nodes for unresolved questions, conflicts, weak evidence, and areas that need future human judgment.
- Action layer: omit by default. Leave follow-up tasks for the user to add later unless explicitly requested.

## Phase 5: Create Canvas Content

Preferred path inside Canvas Agent runtime:

1. Check existing geometry with `pulse-canvas layout read --workspace <id> --format json` before creating or arranging content in an existing workspace.
2. Create frames and nodes with canvas creation tools.
3. For single semantic insertions, use `placement` instead of raw coordinates:
   - `append_canvas` for a new top-level cluster
   - `near_node` for a finding derived from a source or existing node
   - `inside_frame` for content that belongs in a known frame
   - `at` only when the user gave a precise location
4. Create sparse edges with `canvas_create_edge`.

Fallback path outside Canvas Agent runtime — prefer ONE atomic plan over
command loops (one lock, one save, all-or-nothing):

```bash
pulse-canvas workspace create "<topic>" --format json
pulse-canvas apply --workspace <id> --file canvas-plan.json --dry-run --format json
pulse-canvas apply --workspace <id> --file canvas-plan.json --format json
```

Plan shape (full reference: `pulse-canvas apply --help`):

```json
{
  "workspace": "<id>",
  "baseRevision": 3,
  "operations": [
    { "action": "create", "type": "frame", "id": "f-overview", "title": "Overview", "x": 40, "y": 70, "width": 900, "height": 520 },
    { "action": "create", "type": "file", "id": "c-thesis", "title": "One-sentence claim", "x": 80, "y": 130, "width": 480, "height": 300, "content": "- support 1\n- support 2" },
    { "action": "createEdge", "from": "c-thesis", "to": "f-overview", "label": "belongs to", "bend": 24 }
  ]
}
```

- Always `--dry-run` first: it validates every operation with zero writes.
- Include `baseRevision` (read it from a prior `apply` or `layout read`)
  when other writers may touch the workspace; on `revision_conflict`,
  re-read the canvas and rebuild the plan.

Single-node commands remain for small incremental edits:

```bash
pulse-canvas node create --workspace <id> --type file --title "<node>" --data '{"content":"..."}' --format json
pulse-canvas edge create --workspace <id> --from <nodeId> --to <nodeId> --label "<label>" --kind flow --format json
```

Write-safety rules (MANDATORY on the CLI path):

- **Run all canvas mutations sequentially.** Never parallelize `node`/`edge`
  create, update, write, or delete calls — no `&` background jobs, no
  multi-shell fan-out, no concurrent sub-agents mutating the same workspace.
  Every mutation rewrites the whole canvas; parallel writers can drop each
  other's nodes. Batch your changes into one ordered sequence instead.
- **Pass `--workspace <id>` explicitly on every mutation.** Do not rely on
  the active-workspace fallback when several workspaces exist — confirm the
  target once with `pulse-canvas workspace current`, then pin it.

Use fallback coordinates only when no layout tool is available.

## Phase 6: Apply Layout

Layout commands (run them sequentially, like all mutations):

1. For each final frame, arrange its children into a grid and fit the frame:

```bash
pulse-canvas layout frame-grid --workspace <id> --frame <frame-id> --format json
# optional: --columns <n> --gap <px> --padding <px> --no-fit-frame
```

2. Position the frames themselves manually (there is no canvas-level
   auto-grid yet): lay frames out in rows using the manual numbers below,
   after `frame-grid` has settled each frame's final size.

3. Validate the result:

```bash
pulse-canvas layout validate --workspace <id> --format json
```

4. If validation reports overlaps, frame straddling/overflow, narrow cards,
   or an extreme aspect ratio, re-run `frame-grid` on the affected frame or
   move the listed nodes with `node update`, then validate again.

Manual fallback layout:

- Start at `(50, 50)`.
- Use frame padding `24`.
- Use frame gap `100` or more so floating frame titles remain visible.
- Use file node size around `300 x 360`.
- Put 1-3 child nodes in one row, 4 child nodes as a `2 x 2` grid.
- Wrap frames to a new row when the row would exceed roughly `1500px`.

## Phase 7: Verify and Summarize

Before final response, run the dual-view acceptance:

- Validate the final canvas layout (`pulse-canvas layout validate --workspace <id>`).
- **Fit-view check** (the board at overview zoom): it must read as 3-6
  colored regions with legible section chips, thesis cards visibly larger
  than evidence cards, and sources parked on the periphery — not a uniform
  grid of same-size cards.
- **100%-view check**: read 2-3 cards in full; each must be one claim plus
  short support bullets with source ids, not a pasted article.
- Confirm every final frame has useful content.
- Confirm important findings have source ids.
- Confirm edges are sparse, local, and meaningful.
- Summarize the created frames, key findings, source quality, unresolved questions, and any layout caveats.

## Frame Colors

Default is NEUTRAL. Color is a scarce accent, not a per-frame attribute —
a board where every frame carries its own hue reads as a rainbow
dashboard, which is exactly the look to avoid.

- Create frames WITHOUT a `color` (the default is neutral graphite); most
  frames stay graphite.
- Pick AT MOST 3 accent hues per board, on the frames the reader should
  see first, reusing a hue rather than introducing a fourth:

| Accent role | Swatch |
|---|---|
| Entry / overview — "start here" | Sky `oklch(0.68 0.108 224)` |
| Core analysis — the main argument | Sage `oklch(0.68 0.108 142)` |
| Risks / tensions / decisions | Coral `oklch(0.68 0.108 28)` |

- Source and auxiliary-material frames are ALWAYS graphite.

## Quality Rules

1. Approval comes before research execution and canvas mutation.
2. Research findings cite source ids.
3. Draft live-board content is clearly marked as draft.
4. Final content is synthesized and actionable, not copied source fragments.
5. Frames contain 2-4 substantial nodes unless the topic strongly justifies otherwise.
6. One claim per card; long-form depth lives in linked detail cards.
7. Size encodes importance, sources stay on the periphery, and colored
   emphasis stays under ~20% of cards.
6. Layout tools are the default for geometry; manual coordinates are fallback only.
7. Existing unrelated nodes are not moved unless the user approved an organizing action.
8. Edges explain relationships with short labels and meaningful kinds.
9. Uncertainty, conflicts, and open questions remain visible in the canvas.
10. The final canvas focuses on information organization. Action-oriented nodes are opt-in, not default.
