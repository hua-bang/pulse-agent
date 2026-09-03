import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  analyzeRendererStructure,
  renderRendererStructureReport,
} from './check-renderer-structure.mjs';

const roots = [];
const makeRenderer = () => {
  const root = mkdtempSync(join(tmpdir(), 'renderer-structure-'));
  roots.push(root);
  return root;
};
const write = (root, path, content = 'export {};\n') => {
  const target = join(root, path);
  mkdirSync(join(target, '..'), { recursive: true });
  writeFileSync(target, content);
};

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('analyzeRendererStructure', () => {
  it('reports migration pressure and dependency-direction violations', () => {
    const root = makeRenderer();
    write(root, 'agent-chat/runtime.ts');
    write(root, 'components/chat/ChatPanel.tsx', Array.from({ length: 305 }, () => '// line').join('\n'));
    write(root, 'components/ui/Bad.tsx', "import '../../modules/chat';\n");
    write(root, 'modules/chat/index.ts');
    write(root, 'modules/chat/consumer.ts', "import '../mcp-apps/runtime/internal';\n");
    write(root, 'modules/mcp-apps/index.ts');
    write(root, 'modules/mcp-apps/runtime/internal.ts');
    write(root, 'modules/mcp-apps/consumer.ts', "import '../chat';\n");

    const report = analyzeRendererStructure(root);

    expect(report.businessComponentGroups).toEqual(['chat']);
    expect(report.legacyFeatureRoots).toEqual(['agent-chat']);
    expect(report.flatComponentFiles).toEqual([
      'components/chat/ChatPanel.tsx',
    ]);
    expect(report.pressure.visualOver300).toEqual([
      { path: 'components/chat/ChatPanel.tsx', lines: 305 },
    ]);
    expect(report.boundaryErrors.map(item => item.reason)).toEqual([
      'shared component imports product module',
      'cross-module internal import (chat -> mcp-apps)',
    ]);
    expect(report.moduleCycles).toEqual(['chat -> mcp-apps -> chat']);
    expect(report.boundaryCoverage.modulesPresent).toBe(true);
  });

  it('accepts a small module-first fixture and renders a readable report', () => {
    const root = makeRenderer();
    write(root, 'components/ui/Button/index.tsx');
    write(root, 'modules/chat/index.ts');
    write(root, 'modules/chat/components/ChatPanel/index.tsx');
    write(root, 'shared/types.ts');

    const report = analyzeRendererStructure(root);
    const output = renderRendererStructureReport(report);

    expect(report.boundaryErrors).toEqual([]);
    expect(report.businessComponentGroups).toEqual([]);
    expect(report.flatComponentFiles).toEqual([]);
    expect(report.moduleCycles).toEqual([]);
    expect(output).toContain('Renderer structure health (module-first-migration)');
    expect(output).toContain('modules: chat');
  });
});
