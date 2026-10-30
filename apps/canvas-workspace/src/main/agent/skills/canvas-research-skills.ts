import type { DefaultSkill } from './default-skills';

/**
 * Canvas Agent versions of the research-to-canvas workflows.
 *
 * The `pulse-canvas` CLI bundle ships `canvas-bootstrap` and
 * `canvas-frame-research` for external agents (Claude Code, Codex). Those
 * copies mutate the canvas through shell commands and carry
 * `canvas-agent: false`, so the Canvas Agent never loads them. These
 * same-name defaults teach the same workflow with native tools, which keeps
 * every node creation behind the host approval card. Research itself still
 * follows the shared `canvas-deep-research` skill.
 */
export const CANVAS_BOOTSTRAP_SKILL: DefaultSkill = {
  slug: 'canvas-bootstrap',
  name: 'canvas-bootstrap',
  description:
    'Deep-research a topic and build a structured, source-backed canvas with frames, content nodes, and sparse edges, after the user approves depth and plan. Use when the user asks to bootstrap, generate, research, organize, or build an AI-created canvas.',
  body: `# canvas-bootstrap

Turn a topic into a source-backed canvas with native Canvas tools. Research decides what goes on the canvas; layout tools decide where it goes.

## Core contract

- Ask for research depth first, unless the user already gave it.
- After depth is chosen, show a research plan and wait for approval. Do not research or create nodes before approval.
- If the user names a different research skill or tool, use it. Otherwise load \`canvas-deep-research\` with the \`skill\` tool and follow it.
- To expand, verify, or enrich one existing frame, use \`canvas-frame-research\` instead.
- Use the user's language for questions, plans, summaries, and node content.

## Target workspace

- In a workspace chat, build in the current workspace.
- In global chat, resolve the target with \`workspace_list\` and pass its \`workspaceId\` to every Canvas tool. Ask only when the choice is ambiguous.
- No native tool creates a workspace. If the user wants a new one, ask them to create and open it first, or build in a clear empty area of an existing workspace.

## Phase 0: depth

If the user did not choose a depth, ask one short question and stop. Offer three options in the user's language:

- **Quick**: fast scan for direction, 2-4 frames.
- **Standard**: a reliable canvas, 3-6 frames. This is the default.
- **Deep**: stronger source checks, contradictions, risks, and open questions.

## Phase 1: plan approval

Draft the plan, then ask for approval. The plan states:

- research objective, boundary, and questions
- source strategy and planned passes
- provisional frame names, information layers (overview, structure, details, sources, open questions), and the layout preset you will use (see Phase 5)
- the approximate node count, and that each new node shows an approval card. Tell the user once that they can pick the "approve for this session" option on the first card, so a full board does not need one confirmation per node.
- what counts as done

Do not browse or create nodes while you wait.

## Phase 2: research

Follow \`canvas-deep-research\` (or the user's chosen skill), including its Search Tactics: several keyword queries per question, \`searchDepth: "advanced"\` for standard and deep work, and \`tavily_extract\` on every page that supports a key finding. Do not open Dock tabs just to read. Keep a source ledger with ids, cross-check important claims, and label inference, weak evidence, and conflicts.

## Phase 3: canvas plan

Convert the research brief into a canvas plan before you create anything.

- Each frame is one logical category from the research. Aim for 3-6 frames with 2-4 substantial nodes each. Merge frames with one weak node; split frames with more than four.
- **One claim per card.** Title = one assertion; body = 2-5 short support bullets with source ids. Move long prose into a linked detail card.
- **Card budget.** Deep topics land around 25-35 cards in total.
- **Size encodes importance.** Thesis cards widest (about 460-520 px), evidence cards about 320-380 px, side notes smaller.
- **Sources live on the periphery**, at the right or bottom edge, never between claim cards.
- **Highlight budget.** Colored emphasis on at most about 20% of cards.
- **Hue budget.** At most 3 accent frames; all other frames, and every source frame, stay neutral (no \`data.color\`). Accent swatches: entry/overview \`oklch(0.68 0.108 224)\`, core analysis \`oklch(0.68 0.108 142)\`, risks/decisions \`oklch(0.68 0.108 28)\`.
- **Edges are local.** 2-5 meaningful edges with short labels, between neighbors, never across several frames.
- Do not create action, task, terminal, or agent nodes unless the user asks.

If the research changes the approved structure, show the change and ask for a quick confirmation.

## Phase 4: create content

1. Call \`canvas_read_layout\` to see the existing geometry before you add anything to a non-empty canvas.
2. Create each frame with \`canvas_create_node\` (\`type: "frame"\`, width/height large enough for its cards, \`placement: { mode: "append_canvas" }\`).
3. Create each card with \`canvas_create_node\` (\`type: "file"\`) and \`placement: { mode: "inside_frame", frameId }\`, most important card first. Set \`width\` to encode importance and leave \`height\` unset: the card height follows its text. Use \`near_node\` for a card derived from another card, and \`at\` only for a location the user gave.
4. Create edges with \`canvas_create_edge\` (\`sourceNodeId\`, \`targetNodeId\`, \`label\`, \`kind\`, a small \`bend\`).
5. Make the calls one at a time. Do not use \`bash\` or the \`pulse-canvas\` CLI to create nodes.

## Phase 5: layout

1. Pick a preset that matches the content, and say which one in the summary:
   - \`board\` (default for research): an overview frame across the top, detail frames in a row below, the sources frame on the right edge.
   - \`flow\`: steps, stages, a timeline, or a pipeline, read left to right.
   - \`matrix\`: 2x2 comparisons, quadrants, or options side by side.
   - \`stack\`: a report or brief read top to bottom.
   - \`hub\`: one topic in the middle with its facets around it.
   - \`spotlight\`: one main finding as a large frame, with supporting frames beside it.
   - \`masonry\`: many loosely related frames, such as a collection.
2. Call \`canvas_apply_layout\` with \`mode: "preset"\`, the preset, and the new frame ids in reading order in \`nodeIds\`. For \`board\`, pass \`overviewFrameId\` and \`sourcesFrameId\`; for \`hub\` and \`spotlight\`, pass the main frame as \`overviewFrameId\`. The preset arranges the cards inside every frame and fits each frame. On a non-empty canvas, pass \`startX\` / \`startY\` in a clear area from \`canvas_read_layout\` so unrelated nodes do not move.
3. Inside a frame, cards follow the order you created them in. To change it, run \`mode: "frame_grid"\` for that frame with \`nodeIds\` in the order you want, thesis card first.
4. Call \`canvas_apply_layout\` with \`mode: "validate"\`. Fix overlaps with \`canvas_move_node\` / \`canvas_resize_node\`, or rerun the preset with another start point, then validate again.

## Phase 6: verify and summarize

- Overview check: the board reads as 3-6 regions, thesis cards are larger than evidence cards, and sources sit on the edge.
- Detail check: read 2-3 cards with \`canvas_read_node\`. Each is one claim plus short bullets with source ids.
- Every frame has useful content, important findings have source ids, and edges are sparse and local.
- Summarize the frames, key findings, source quality, open questions, and any layout caveats.
`,
};

export const CANVAS_FRAME_RESEARCH_SKILL: DefaultSkill = {
  slug: 'canvas-frame-research',
  name: 'canvas-frame-research',
  description:
    'Extend one existing canvas frame with local, source-backed research while leaving the rest of the canvas alone. Use when the user asks to research, enrich, expand, verify, update, or add sources inside a selected or named frame, rather than build a whole new canvas.',
  body: `# canvas-frame-research

Research inside one existing frame and add layered information back into it, with native Canvas tools. This is local expansion, not whole-canvas generation.

## Core contract

- Work inside one target frame. Do not create a workspace, reorganize the canvas, or move nodes outside the frame.
- Do not create action, task, terminal, or agent nodes unless the user asks.
- If the user names a research skill or tool, use it. Otherwise load \`canvas-deep-research\` with the \`skill\` tool and follow its protocol at local scale.
- Use the user's language for questions, summaries, and node content.

## Phase 0: resolve the target frame

1. Prefer the frame the user selected or mentioned in this message.
2. If child nodes are selected, use the frame that contains them (\`canvas_read_layout\` shows containment).
3. If the user named a frame, find it by exact or near-exact title with \`canvas_search_nodes\`.
4. If several frames match, ask the user to choose. If none is found, ask the user to select or name one.

Then read the frame: \`canvas_read_layout\` for bounds and children, \`canvas_read_node\` for the frame and relevant children, and \`canvas_list_edges\` when relationships matter.

## Phase 1: local intent and depth

Pick the intent: fill gaps, add sources, deepen, compare, verify, or update stale facts. If the request is broad or likely to add many nodes, ask for depth in the user's language (quick 1-3 nodes, standard 3-6, deep 5-9 only if the frame stays readable). For a small obvious addition, use quick and say so.

## Phase 2: local research

Reuse the frame's content first. Then use \`tavily\` / \`tavily_extract\` for current or unstable facts. Prefer primary sources, keep source ids visible, separate facts from inference, and surface conflicts. If findings belong outside the frame, ask before creating a sibling frame.

## Phase 3: local plan

For more than one or two nodes, show a compact plan first: the nodes to add or update, their layer (overview, structure, detail, source, open question), and their sources. Each new node shows an approval card; mention once that the user can approve for the session.

## Phase 4: create or update nodes

1. Create nodes with \`canvas_create_node\` and \`placement: { mode: "inside_frame", frameId }\`.
2. Prefer \`canvas_update_node\` on an existing child when extending it is cleaner than adding a duplicate.
3. Connect only meaningful local relationships with \`canvas_create_edge\`.
4. Make the calls one at a time. Do not use \`bash\` or the \`pulse-canvas\` CLI to create nodes.

## Phase 5: layout only the frame

Call \`canvas_apply_layout\` with \`mode: "frame_grid"\`, the target \`frameId\`, and \`nodeIds\` in reading order (the frame's summary or thesis card first), then \`mode: "validate"\`. Fix flagged nodes with \`canvas_move_node\` or \`canvas_resize_node\`. Do not touch frames outside the target.

## Phase 6: summarize

Tell the user what was added or updated, which sources support it, what remains uncertain, and whether anything should move to a sibling frame. If the frame is crowded, suggest a split instead of adding more nodes.
`,
};
