import type { DefaultSkill } from './default-skills';

/**
 * Tidy or redesign the layout of an existing canvas with the layout presets
 * in `canvas_apply_layout`. Research skills lay out the boards they create;
 * this skill covers boards the user already has.
 */
export const CANVAS_TIDY_LAYOUT_SKILL: DefaultSkill = {
  slug: 'canvas-tidy-layout',
  name: 'canvas-tidy-layout',
  description:
    'Tidy, rearrange, or redesign the layout of an existing canvas or frame with layout presets (board, flow, matrix, stack, hub, spotlight, masonry), without changing node content. Use when the user asks to organize, tidy, clean up, align, arrange, or re-layout nodes or frames.',
  body: `# canvas-tidy-layout

Rearrange what is already on the canvas so it reads as clear regions. Move and resize only; never change node content, and never delete nodes.

## 1. Read the board

1. Call \`canvas_read_layout\`. Note the frames, their children, loose nodes outside frames, and overlaps.
2. If the user selected nodes or named a frame, work only on those. Otherwise the scope is the whole canvas.
3. Read 2-3 frame or card titles with \`canvas_read_node\` only if the titles do not show what the regions are.

## 2. Pick a design

Pick one preset from the content, not from habit:

| Content | Preset |
| --- | --- |
| Overview plus several topics, with sources or references | \`board\` |
| Steps, stages, a timeline, a pipeline, or kanban columns | \`flow\` |
| 2-4 options or quadrants compared side by side | \`matrix\` |
| A report or brief that reads top to bottom | \`stack\` |
| One topic in the middle with 3-8 facets around it | \`hub\` |
| One main finding with 1-6 supporting frames | \`spotlight\` |
| Many loosely related frames: a collection, references, a mood board | \`masonry\` |

Decide the frame order: the order a reader should follow (overview first, sources last). For \`board\`, pick the overview frame and, if there is one, the sources frame. For \`hub\` and \`spotlight\`, pick the main frame.

If the board has many loose nodes and no frames, propose frames first: which nodes go together and the frame titles. Creating frames shows approval cards, so describe the plan once and then create them with \`canvas_create_node\` (\`type: "frame"\`) and move the nodes inside with \`canvas_move_node\`.

For a small change (one frame, or the user said "just tidy"), skip the preset and run \`frame_grid\` or \`region_grid\` on that scope.

## 3. Apply

1. Call \`canvas_apply_layout\` with \`mode: "preset"\`, the preset, the frame ids in reading order in \`nodeIds\`, \`overviewFrameId\` for \`board\`, \`hub\`, and \`spotlight\`, and \`sourcesFrameId\` for \`board\`. The preset also arranges the cards inside every frame, fits each frame, aligns frame edges, and widens cards to fill stretched frames.
2. To change the card order inside a frame (most important first), run \`mode: "frame_grid"\` with that \`frameId\` and \`nodeIds\` in the order you want.
3. Leave nodes with \`data.layoutLocked: true\` and nodes outside the scope where they are.

## 4. Check

1. Call \`canvas_apply_layout\` with \`mode: "validate"\`. Fix each overlap with \`canvas_move_node\` or by rerunning the preset with \`startX\` / \`startY\` in a clear area.
2. Tell the user which preset you used and why, in one or two sentences, and offer another preset if the content fits more than one.
`,
};
