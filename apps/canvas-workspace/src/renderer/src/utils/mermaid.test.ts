// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { renderMermaidSource } from './mermaid';

// Invalid flowchart syntax (unclosed bracket) — a stand-in for what an LLM
// occasionally emits. Regression for a bug where mermaid's own parse-error
// recovery swallowed the error and resolved render() with its built-in
// "bomb icon" error SVG instead of rejecting, so this always looked `ok`
// and bypassed the app's chat-mermaid-error / inline-visual error UI.
const BROKEN_MERMAID = 'flowchart TD\n  A[Start --> B\n';

describe('renderMermaidSource', () => {
  it('reports invalid syntax as a failure instead of resolving with a diagram', async () => {
    const result = await renderMermaidSource(BROKEN_MERMAID);
    expect(result.ok).toBe(false);
  });

  it('renders valid syntax to an svg', async () => {
    const result = await renderMermaidSource('flowchart TD\n  A --> B\n');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.svg).toContain('<svg');
  });
});
