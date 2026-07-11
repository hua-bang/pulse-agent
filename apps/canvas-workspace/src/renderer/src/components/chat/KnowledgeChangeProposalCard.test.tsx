// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { KnowledgeChangeProposal } from '../../../../shared/knowledge-change';
import { I18nProvider } from '../../i18n';
import { KnowledgeChangeProposalCard } from './KnowledgeChangeProposalCard';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const PROPOSAL: KnowledgeChangeProposal = {
  kind: 'knowledge-change-proposal',
  version: 1,
  proposalId: 'proposal-card-test',
  target: {
    workspaceId: 'workspace-1',
    workspaceName: 'Research',
    nodeId: 'node-1',
    nodeType: 'text',
    nodeTitle: 'Original title',
    expectedUpdatedAt: 10,
    expectedFingerprint: 'a'.repeat(64),
  },
  summary: 'Make the title more precise.',
  before: { title: 'Original title' },
  patch: { title: 'Precise title' },
};

let root: Root | null = null;
let host: HTMLDivElement | null = null;

afterEach(() => {
  if (root) act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
  window.localStorage.clear();
  Reflect.deleteProperty(window, 'canvasWorkspace');
});

const renderCard = () => {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => {
    root?.render(
      <I18nProvider>
        <KnowledgeChangeProposalCard proposal={PROPOSAL} />
      </I18nProvider>,
    );
  });
  return host;
};

describe('KnowledgeChangeProposalCard', () => {
  it('applies only after the explicit Apply action and records the success state', async () => {
    const applyProposal = vi.fn(async () => ({
      ok: true as const,
      workspaceId: 'workspace-1',
      nodeId: 'node-1',
      updatedAt: 11,
    }));
    Object.defineProperty(window, 'canvasWorkspace', {
      configurable: true,
      value: { workspaceNodes: { applyProposal } },
    });
    const view = renderCard();
    const applyButton = Array.from(view.querySelectorAll('button'))
      .find((button) => button.textContent === 'Apply change');
    if (!applyButton) throw new Error('Expected the Apply change button');

    expect(applyProposal).not.toHaveBeenCalled();
    await act(async () => {
      applyButton.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
    });

    expect(applyProposal).toHaveBeenCalledWith(PROPOSAL);
    expect(view.textContent).toContain('Applied to node');
    expect(window.localStorage.getItem('knowledge-change-proposals:status:v1')).toContain('applied');
    expect(document.activeElement).toBe(view.querySelector('.knowledge-change-card__actions'));
  });

  it('discards locally without invoking the write bridge', () => {
    const applyProposal = vi.fn();
    Object.defineProperty(window, 'canvasWorkspace', {
      configurable: true,
      value: { workspaceNodes: { applyProposal } },
    });
    const view = renderCard();
    const discardButton = Array.from(view.querySelectorAll('button'))
      .find((button) => button.textContent === 'Discard');
    if (!discardButton) throw new Error('Expected the Discard button');

    act(() => {
      discardButton.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(applyProposal).not.toHaveBeenCalled();
    expect(view.textContent).toContain('Proposal discarded');
  });

  it('keeps a conflict actionable so the stale proposal can be discarded', async () => {
    const applyProposal = vi.fn(async () => ({
      ok: false as const,
      code: 'conflict' as const,
      error: 'The node changed.',
    }));
    Object.defineProperty(window, 'canvasWorkspace', {
      configurable: true,
      value: { workspaceNodes: { applyProposal } },
    });
    const view = renderCard();
    const applyButton = Array.from(view.querySelectorAll('button'))
      .find((button) => button.textContent === 'Apply change');
    if (!applyButton) throw new Error('Expected the Apply change button');

    await act(async () => {
      applyButton.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
    });

    expect(view.textContent).toContain('This node changed after the proposal was created.');
    expect(Array.from(view.querySelectorAll('button')).some((button) => button.textContent === 'Discard')).toBe(true);
  });
});
