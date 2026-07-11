import { describe, expect, it } from 'vitest';
import {
  renderHarnessGraph,
  renderBilingualHarnessGraphTabs,
  renderHarnessGraphTabs,
  validateHarnessData,
} from './render-harness-graph.mjs';
import { createAllScopeGraphs, createScopeGraph } from './scope-graphs.mjs';

function sampleData() {
  return {
    title: 'Engine <Harness>',
    subtitle: 'Progressive reading for root, package, or app scopes.',
    scope: 'packages/engine',
    metrics: [
      { value: '9', label: 'built-in plugins' },
      { value: '36', label: 'tools' },
    ],
    entryNodes: [
      {
        title: 'Root AGENTS.md',
        detail: 'Find the workspace owner.',
      },
      {
        title: 'packages/engine/AGENTS.md',
        detail: 'Read local constraints and routes.',
      },
    ],
    branches: [
      {
        id: 'public-api',
        label: 'Public API',
        intent: ['Inspect exports'],
        sources: ['harness/knowledge/contracts.md', 'src/index.ts'],
        reads: ['Two public barrels'],
        evidence: ['Four main-barrel omissions', '</script><script>alert(1)</script>'],
        level: 4,
      },
    ],
    evidenceLevels: [
      { title: 'Entry', detail: 'Rules' },
      { title: 'Knowledge', detail: 'Facts' },
      { title: 'Source', detail: 'Implementation' },
      { title: 'Checks', detail: 'Behavior' },
    ],
    boundary: 'Do not read .env or user data automatically.',
  };
}

describe('validateHarnessData', () => {
  it('accepts a complete harness graph', () => {
    expect(validateHarnessData(sampleData())).toEqual(sampleData());
  });

  it('rejects an empty branch list', () => {
    const data = sampleData();
    data.branches = [];

    expect(() => validateHarnessData(data)).toThrow('branches must contain at least one item');
  });

  it('rejects evidence levels outside the declared range', () => {
    const data = sampleData();
    data.branches[0].level = 5;

    expect(() => validateHarnessData(data)).toThrow('branches[0].level must be between 1 and 4');
  });
});

describe('renderHarnessGraph', () => {
  it('renders a complete interactive HTML document and escapes embedded data', () => {
    const html = renderHarnessGraph(sampleData());

    expect(html).toContain('<!doctype html>');
    expect(html).toContain('<title>Engine &lt;Harness&gt;</title>');
    expect(html).toContain('id="intent-grid"');
    expect(html).toContain("button.addEventListener('click'");
    expect(html).toContain('public-api');
    expect(html).not.toContain('</script><script>alert(1)</script>');
    expect(html).toContain('\\u003c/script\\u003e\\u003cscript\\u003ealert(1)\\u003c/script\\u003e');
  });

  it('renders Chinese interface copy when the input locale is zh', () => {
    const data = sampleData();
    data.locale = 'zh';

    const html = renderHarnessGraph(data);

    expect(html).toContain('<html lang="zh-CN">');
    expect(html).toContain('选择任务意图以展开阅读路径');
    expect(html).toContain('具体证据');
  });
});

describe('createScopeGraph', () => {
  it.each(['root', 'engine', 'canvas-workspace', 'remote-server'])('builds a complete English graph for %s', (scope) => {
    const graph = createScopeGraph(scope);

    expect(validateHarnessData(graph)).toBe(graph);
    expect(graph.locale).toBe('en');
    expect(graph.branches.length).toBeGreaterThan(0);
    expect(graph.metrics.length).toBeGreaterThan(0);
  });

  it('builds Chinese scope content and rejects unknown scopes', () => {
    const graph = createScopeGraph('canvas-workspace', 'zh');

    expect(graph.title).toContain('阅读图');
    expect(graph.branches[0].label).toContain('修改');
    expect(() => createScopeGraph('orchestrator')).toThrow('Unknown scope');
  });

  it('combines all built-in scopes in one tabbed document', () => {
    const html = renderHarnessGraphTabs(createAllScopeGraphs('zh'), 'zh');

    expect(html).toContain('仓库根目录');
    expect(html).toContain('Canvas Workspace');
    expect(html).toContain('role="tablist"');
    expect(html).toContain('srcdoc=');
  });

  it('switches all scopes between English and Chinese inside one document', () => {
    const html = renderBilingualHarnessGraphTabs({
      en: createAllScopeGraphs('en'),
      zh: createAllScopeGraphs('zh'),
    }, 'zh');

    expect(html).toContain('data-language="en"');
    expect(html).toContain('data-language="zh"');
    expect(html).toContain('selectScope(locale, selectedScope)');
    expect(html).toContain('修改某个工作区');
    expect(html).toContain('Change a workspace');
  });
});
