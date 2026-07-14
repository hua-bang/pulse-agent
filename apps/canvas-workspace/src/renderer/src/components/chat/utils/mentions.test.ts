// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { createMentionChipElement, renderMdWithMentions } from './mentions';
import { serializeEditable } from './serializeEditable';

const domLabel = 'header: Fancy Builder [...truncated]';

describe('chat mention rendering', () => {
  it('serializes DOM selection labels with bracket-safe encoding', () => {
    const chip = createMentionChipElement({
      type: 'dom',
      label: domLabel,
      nodeType: 'iframe',
      domSelection: {
        id: 'dom-1',
        label: domLabel,
        nodeId: 'node-1',
        selector: 'header',
      },
    });
    const editable = document.createElement('div');
    editable.appendChild(chip);

    expect(serializeEditable(editable)).toBe(`@[dom:dom-1|${encodeURIComponent(domLabel)}]`);
  });

  it('renders encoded DOM selection labels without leaking a closing bracket', () => {
    const html = renderMdWithMentions(`@[dom:dom-1|${encodeURIComponent(domLabel)}] 这描述了啥`);

    expect(html).toContain(domLabel);
    expect(html).not.toContain('</span>]');
  });

  it('keeps legacy DOM labels ending in a bracketed suffix inside the chip', () => {
    const html = renderMdWithMentions(`@[dom:dom-1|${domLabel}] 这描述了啥`);

    expect(html).toContain(domLabel);
    expect(html).not.toContain('</span>]');
  });

  it('uses a readable title when a selected session is inserted as a reference', () => {
    const chip = createMentionChipElement({
      type: 'session',
      label: '@[dom:dom-1|td%3A%20Latest%20commit] 这块区域描述了啥',
      sessionId: 'session-1',
      workspaceId: 'workspace-1',
    });

    expect(chip.dataset.mention).toBe('session:workspace-1:session-1:|td: Latest commit 这块区域描述了啥');
    expect(chip.textContent).toContain('td: Latest commit 这块区域描述了啥');
    expect(chip.textContent).not.toContain('dom-1');
  });
});
