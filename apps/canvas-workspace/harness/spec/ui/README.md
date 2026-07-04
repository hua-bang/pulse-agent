# Canvas Workspace UI Spec

Status: initial harness spec.

This is the workspace-local source of truth for UI consistency in
`canvas-workspace`. Read it with:

- `research.md`
- `docs/conventions/frontend.md`
- `docs/renderer-surfaces.md`
- `src/renderer/src/styles.css`
- `harness/tools/ui-audit/README.md`

## Research Baseline

Mature frontend teams converge on a few mechanisms:

- Design tokens carry reusable design decisions. Atlassian calls tokens the
  single source of truth for naming and storing design decisions:
  https://atlassian.design/components/tokens/all-tokens
- Primer uses tokens as an abstraction for maintainability, consistency, and
  theming, and separates base, functional, and component/pattern tokens:
  https://primer.style/product/getting-started/foundations/color-usage/
- Polaris organizes guidance into foundations, patterns, components, tokens,
  icons, and tools: https://polaris-react.shopify.com/
- Material describes design tokens as shared building blocks used in designs,
  tools, and code: https://m3.material.io/foundations/design-tokens
- Storybook solves component-state inventory and reuse by developing UI in
  isolation, saving states as stories, and reusing those stories for docs and
  tests: https://storybook.js.org/docs/get-started/why-storybook
- Atlassian's AI-era design-system model is especially relevant to harness:
  core foundations, cross-product/platform patterns, and app-specific
  components, with structured context files that agents can consume:
  https://www.atlassian.com/blog/ai-at-work/atlassian-design-system-building-the-context-engine-for-the-ai-era

The immediate lesson for this repo: do not start by adding a large design-system
platform. First make existing decisions legible, route agents toward reuse, and
add lightweight drift detection. Heavier tooling can graduate later.

## Product Shape

`canvas-workspace` is an Electron workbench. It should feel quiet, dense, and
operational:

- Canvas-first: the canvas remains the primary object of attention.
- Work-focused: prefer compact controls, predictable panels, and scan-friendly
  hierarchy over marketing-style composition.
- Warm neutral base: preserve the current canvas/surface contrast unless a
  deliberate redesign changes the token layer.
- Mono-leaning typography is part of the current product feel; do not migrate it
  piecemeal.
- Visual detail should clarify state or affordance. Avoid decoration that does
  not improve orientation, hierarchy, or interaction.

## Composition Model

Use a three-layer model:

| Layer | Local source | Role |
|---|---|---|
| Foundations | `src/renderer/src/styles.css` | Tokens for color, text, border, radius, shadow, spacing candidates, and layer scale. |
| Workbench patterns | `AppShellProvider`, `Sidebar`, `ReferenceDrawer`, `RightDock`, `CommandPalette`, `SettingsDrawer`, `FloatingToolbar` | Shared app surfaces and interaction containers. |
| Domain UI | `CanvasNodeView`, node bodies, agent/team/plugin/workspace views | Product-specific components that express canvas concepts. |

Graduation rule: if a pattern appears in two or more unrelated surfaces, either
reuse the existing component or explicitly graduate the repeated behavior into a
shared component/hook/class. Do not clone a near-identical panel, toolbar, menu,
or state treatment into another feature.

## Reuse Decision Tree

Before adding UI:

1. Can the change be a state, prop, or slot of an existing component?
2. Is it a known workbench surface?
   - Right-side preview or assistant-adjacent panel: use `RightDock`.
   - Lookup/reference/supporting material: use `ReferenceDrawer`.
   - Global command: use `CommandPalette`.
   - App or workspace settings: use the existing settings surface.
   - Canvas action cluster: reuse or extend `FloatingToolbar`.
3. Is it a node-specific domain body? Keep it local to the node body, but reuse
   foundation tokens and shared state rules.
4. Does it need a new top-level surface? Re-read `docs/renderer-surfaces.md`
   first. New top-level containers are exceptional.

## Token Contract

New UI should prefer semantic tokens from `styles.css`:

- Use `var(--surface)`, `var(--bg)`, `var(--border)`, `var(--text)`,
  `var(--text-secondary)`, `var(--accent)`, `var(--shadow-*)`,
  `var(--radius*)`, and `var(--layer-*)` before raw values.
- Do not add ad hoc full-app `z-index` values. Add or reuse a `--layer-*` token.
- Do not introduce one-off colors in feature CSS when an existing semantic token
  communicates the state.
- Token definitions belong in `styles.css` unless the value is strictly
  component-private and not reusable.

Raw visual values are acceptable only for:

- token definitions;
- data-driven canvas colors, frame colors, node colors, or plugin-provided
  palettes;
- terminal/editor/theme rendering where the source system owns the palette;
- prototypes under `design/`;
- exported or external content previews.

## Surface And Layout Contract

- Keep the two-region model from `docs/renderer-surfaces.md`: left navigation
  and reference space, central canvas, right dock, modal tier above.
- Use stable dimensions for toolbars, icon buttons, counters, docks, and node
  chrome so hover/loading/selection states do not shift layout.
- UI text must not overlap or overflow controls. Prefer truncation, wrapping, or
  fixed control widths over letting content resize toolbars.
- Modal behavior belongs in modal surfaces; docks and drawers remain non-modal
  unless the interaction explicitly requires blocking.
- Use layer tokens for full-app surfaces.

## Component Contract

Components should follow `docs/conventions/frontend.md`:

- Named arrow components and explicit `Props` interfaces.
- Non-trivial components live in a folder with `index.tsx`, `index.css`, and
  colocated tests/hooks/subcomponents where needed.
- Keep production `.ts` and `.tsx` files at or below the local file-size gate.
- Move complex behavior into hooks or subcomponents rather than growing a visual
  component indefinitely.
- User-facing copy goes through `useI18n()` and `i18n/messages.ts`.

## State Contract

Every reusable or repeated UI pattern should define its visible states:

- default
- hover
- focus-visible
- selected/current
- active/pressed
- disabled
- loading
- error
- empty
- dragging/resizing when relevant

Keyboard focus should be visible. Pointer-only affordances must have a keyboard
or command-palette path when they trigger durable app actions.

## Motion Contract

Motion should make state changes understandable. Keep transitions short and
local. If a surface animates layout, panel visibility, or large canvas-adjacent
movement, respect `prefers-reduced-motion`.

## Tooling

Current first-stage tool:

```bash
node apps/canvas-workspace/harness/tools/ui-audit/cli.mjs
```

The audit reports token inventory and likely drift:

- raw color literals outside `styles.css`;
- numeric `z-index` values;
- literal `border-radius` values;
- pixel `font-size` declarations;
- negative `letter-spacing`;
- inline TSX style objects.

The tool is intentionally non-blocking by default because the current renderer
has historical CSS. Use `--fail-on-findings` only after a baseline is ratcheted.

Future candidates:

- Storybook or an equivalent component-state catalog for high-churn reusable
  components.
- Visual regression snapshots for shared workbench patterns.
- A stricter CSS/token linter once token migration has a baseline.

Do not add these heavier tools until there is a concrete repeated UI surface
that needs isolated state coverage.

## Acceptance

For UI-affecting changes:

1. Read this spec, `docs/conventions/frontend.md`, and
   `docs/renderer-surfaces.md`.
2. Reuse existing workbench surfaces before adding containers.
3. Run:

   ```bash
   node apps/canvas-workspace/harness/tools/ui-audit/cli.mjs
   ```

4. For visual or interaction-heavy changes, use the runtime harness when
   feasible:

   ```bash
   pnpm --filter canvas-workspace harness start --profile demo --build
   pnpm --filter canvas-workspace harness snapshot-ui
   pnpm --filter canvas-workspace harness screenshot
   pnpm --filter canvas-workspace harness close --cleanup
   ```

5. Run the local validation commands bound to the changed paths.

## Migration Backlog

- Establish a raw-token baseline from `ui-audit`.
- Decide whether spacing and typography need explicit token scales.
- Identify repeated toolbar/menu/button/panel patterns worth graduating.
- Consider Storybook only after component-state reuse pressure is visible.
