import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { inspectHarness } from './check-harness.mjs';
import { cleanupFixtures, createFixture, initializeFixtureGit, writeFixture } from './test-support.mjs';

afterEach(cleanupFixtures);
const doc = 'packages/example/harness/knowledge/guide.md';

describe('deep document diagnostics', () => {
  it('keeps the deep scan opt-in and separate from structural failures', () => {
    const root = createFixture();
    writeFixture(root, doc, 'Runtime behavior uses [source](../../src/missing.ts).\n');
    expect(inspectHarness(root).docWarnings).toEqual([]);
    const result = inspectHarness(root, { deepDocs: true });
    expect(result.harnessGaps).toBe(0);
    expect(result.documentScan.documentsInspected).toBe(1);
    expect(result.docWarnings).toEqual([expect.objectContaining({
      file: doc, line: 1, reference: '../../src/missing.ts', kind: 'missing-markdown-target',
    })]);
  });

  it('does not flag runtime, historical, code-example, or external references', () => {
    const root = createFixture();
    writeFixture(root, doc, [
      '[source](../../src/index.ts)',
      '[runtime image](../../.pulse-coder/generated-images/example.png)',
      '[plugin](../../.pulse-coder/engine-plugins/example.plugin.js)',
      '[runtime config](../../.pulse-coder/config.json)',
      'Historical: [old](../../src/removed.ts)',
      '[retired spec](../spec/removed.md)',
      'Non-existent example: TICKsrc/missing.ts:42TICK',
      'TICKTICKTICKmd', '[example](missing.md)', 'TICKTICKTICK',
      'TICK[inline example](missing.md)TICK',
      '[external](https://example.com/docs)',
      '[local section](#section)',
    ].join('\n').replaceAll('TICK', String.fromCharCode(96)));
    expect(inspectHarness(root, { deepDocs: true }).docWarnings).toEqual([]);
  });

  it('checks explicit source citations and reference-style links', () => {
    const root = createFixture();
    writeFixture(root, doc, [
      'TICKsrc/index.ts:9TICK and TICKsrc/deleted.ts:27-29TICK',
      '[missing-ref]: ../../src/absent.ts',
    ].join('\n').replaceAll('TICK', String.fromCharCode(96)));
    const warnings = inspectHarness(root, { deepDocs: true }).docWarnings;
    expect(warnings.map((warning) => warning.kind)).toEqual(['missing-source-citation', 'missing-markdown-target']);
    expect(warnings[0].reference).toBe('src/deleted.ts');
  });

  it('does not hide tracked source under a normally generated runtime directory', () => {
    const root = createFixture();
    const source = 'packages/example/.pulse-coder/engine-plugins/owned.plugin.js';
    writeFixture(root, source, 'export {};');
    writeFixture(root, doc, '[owned plugin](../../.pulse-coder/engine-plugins/owned.plugin.js)');
    initializeFixtureGit(root);
    fs.unlinkSync(path.join(root, source));
    expect(inspectHarness(root, { deepDocs: true }).docWarnings).toHaveLength(1);
  });

  it('resolves unique owner-relative shorthand and labels ambiguous citations honestly', () => {
    const root = createFixture();
    writeFixture(root, 'packages/example/src/nested/unique.ts', 'export {};');
    writeFixture(root, 'packages/example/src/a/shared.ts', 'export {};');
    writeFixture(root, 'packages/example/src/b/shared.ts', 'export {};');
    writeFixture(root, doc, 'TICKunique.ts:2TICK and TICKshared.ts:3TICK'.replaceAll('TICK', String.fromCharCode(96)));
    initializeFixtureGit(root);
    const warnings = inspectHarness(root, { deepDocs: true }).docWarnings;
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatchObject({ kind: 'ambiguous-source-citation', reference: 'shared.ts' });
    expect(warnings[0].candidates).toHaveLength(2);
  });

  it('reports full-entry and reading-chain character counts as context-cost information', () => {
    const root = createFixture();
    writeFixture(root, 'harness/README.md', 'Shared intro.');
    const result = inspectHarness(root);
    const entry = result.entryMetrics.find((item) => item.file === 'packages/example/AGENTS.md');
    expect(entry.readingChainCharacters).toBe(
      fs.readFileSync(path.join(root, 'AGENTS.md'), 'utf8').length +
      'Shared intro.'.length + fs.readFileSync(path.join(root, entry.file), 'utf8').length,
    );
    expect(result.characterUnit).toBe('UTF-16 code units');
  });
});
