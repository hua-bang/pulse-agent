import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';

/**
 * Node Detail's stylesheets and its markup must describe the same surface.
 *
 * The panel was rebuilt around `<details>` disclosures and NodeRelationEditor
 * without deleting the chrome it replaced: eleven class families
 * (`__header`, `__section*`, `__collapse*`, `__link-row`, …) kept their rules
 * in two files while nothing rendered them, and the relations wrapper carried
 * a `__links` class that no rule matched. Dead rules are not inert — they get
 * copied, they collide when a later change reuses a name (`__actions` did),
 * and they make the real styling impossible to read.
 *
 * Both directions are checked because both drifted.
 */
const read = (relativePath: string): string =>
  readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), 'utf8');

const STYLESHEETS = [
  '../index.css',
  '../NodeDetailDocument.css',
  '../NodeDetailContextRail/index.css',
  '../NodeRelationEditor/index.css',
];
const MARKUP = [
  '../NodeDetailPanel.tsx',
  '../NodeDetailHeader.tsx',
  '../NodeDetailInspector.tsx',
  '../NodeDetailContextRail/index.tsx',
  '../NodeDetailPropertyRows.tsx',
  '../NodeDetailSupplementary.tsx',
  '../NodeDetailPage.tsx',
  '../NodeCanvasPreview.tsx',
  '../NodeCanvasSaveError.tsx',
  '../NodeRelationEditor/index.tsx',
  '../NodeTagEditor.tsx',
  '../NodeTitleEditor.tsx',
  '../../../dock/internal/RightDock/NodeDetailDockTab.tsx',
];

/** The two families this surface owns; other `.workspace-node-*` classes are
 *  shared with the Nodes list and graph pages, which this test does not read. */
const OWNED_CLASS = /\b(node-detail-panel|node-relation-editor)__[a-z-]+/g;

const css = STYLESHEETS.map(read).join('\n');
const markup = MARKUP.map(read).join('\n');

const classesIn = (source: string, pattern: RegExp): string[] =>
  Array.from(new Set(source.match(pattern) ?? [])).sort();

describe('Node Detail styles', () => {
  it('uses a global surface token for the body-portaled inspector', () => {
    expect(css).toMatch(
      /\.node-detail-panel__inspector\s*\{[^}]*background:\s*var\(--surface\)/s,
    );
  });

  it('extends the Nodes token scope to the body-portaled inspector', () => {
    expect(css).toMatch(
      /\.node-detail-panel__inspector,\s*\.node-detail-panel\s*\{[^}]*--nodes-border:/s,
    );
  });

  it('has no rule for a class the markup never renders', () => {
    // A `.cls` that is never followed by another class-name character, so
    // `.node-detail-panel__title` does not count as used by `__title-row`.
    const styled = classesIn(css, OWNED_CLASS).filter((cls) =>
      new RegExp(`\\.${cls}(?![a-z-])`).test(css),
    );
    const orphaned = styled.filter((cls) => !new RegExp(`${cls}(?![a-z-])`).test(markup));

    expect(orphaned).toEqual([]);
  });

  it('has no class in the markup that no rule matches', () => {
    const rendered = classesIn(markup, OWNED_CLASS);
    const unstyled = rendered.filter((cls) => !new RegExp(`\\.${cls}(?![a-z-])`).test(css));

    expect(unstyled).toEqual([]);
  });
});
