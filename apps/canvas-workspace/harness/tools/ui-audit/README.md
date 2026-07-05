# Canvas UI Audit Tool

`ui-audit` is a lightweight inventory tool for renderer UI consistency. It is
not a formatter, linter, or visual regression system.

Run from the repository root:

```bash
node apps/canvas-workspace/harness/tools/ui-audit/cli.mjs
node apps/canvas-workspace/harness/tools/ui-audit/cli.mjs --json
```

Use `--fail-on-findings` only after the team has agreed on a baseline.

## What It Checks

- Design token names declared in `src/renderer/src/styles.css`.
- Raw color literals outside `styles.css` while ignoring CSS comments.
- Numeric `z-index` declarations.
- Literal `border-radius` declarations.
- Pixel `font-size` declarations.
- Negative `letter-spacing`.
- Inline TSX style objects.

These findings point to drift candidates. Some are legitimate, especially
data-driven canvas colors, plugin palettes, terminal/editor themes, prototypes,
and generated/external content.

## Why This Exists

The UI spec should be consumable by agents and humans, but the repo also needs a
cheap way to see when implementation drifts. This tool gives us that first
mechanical feedback loop without introducing Storybook, visual regression, or a
new CSS toolchain yet.
