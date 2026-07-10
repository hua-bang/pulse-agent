// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AgentContextDomReviewComment, AgentContextDomSelectionRef } from '../../types';
import { IframeReviewLayer } from './IframeReviewLayer';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLDivElement | null = null;

afterEach(() => {
  if (root) act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
});

function render(node: React.ReactNode) {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => {
    root?.render(node);
  });
}

const SELECTION: AgentContextDomSelectionRef = {
  id: 'sel-1',
  label: 'Header',
  nodeId: 'node-1',
  selector: 'header',
  rect: { x: 10, y: 10, width: 100, height: 20 },
};

const COMMENT: AgentContextDomReviewComment = {
  id: 'review-1',
  text: 'Make this bigger',
  selection: SELECTION,
};

function baseProps(overrides: Partial<Parameters<typeof IframeReviewLayer>[0]> = {}) {
  return {
    comments: [],
    draftSelection: null,
    draftText: '',
    sending: false,
    onDraftTextChange: vi.fn(),
    onSaveDraft: vi.fn(),
    onCancelDraft: vi.fn(),
    onUpdateComment: vi.fn(),
    onRemoveComment: vi.fn(),
    onSubmit: vi.fn(),
    onClear: vi.fn(),
    ...overrides,
  };
}

/**
 * Pilot slice (IframeNodeBody family, batch 2). IframeReviewLayer's buttons
 * and textareas were evaluated for migration onto ui/Button and
 * ui/TextField and kept as-is (see ui-reuse-burndown.md's "pilot slice"
 * section for the per-instance verdicts) — this component has no Electron/
 * webview coupling, so its composer behavior is directly testable.
 */
describe('IframeReviewLayer', () => {
  it('typing in the draft textarea reports the new value via onDraftTextChange', () => {
    const onDraftTextChange = vi.fn();
    render(<IframeReviewLayer {...baseProps({ draftSelection: SELECTION, onDraftTextChange })} />);
    const textarea = document.querySelector('.iframe-review-popover--draft .iframe-review-textarea') as HTMLTextAreaElement;
    expect(textarea).not.toBeNull();
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')!.set!;
      setter.call(textarea, 'Use the accent color here');
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(onDraftTextChange).toHaveBeenCalledWith('Use the accent color here');
  });

  it('Cmd+Enter in the draft textarea saves the draft, Escape cancels it', () => {
    const onSaveDraft = vi.fn();
    const onCancelDraft = vi.fn();
    render(
      <IframeReviewLayer
        {...baseProps({ draftSelection: SELECTION, draftText: 'looks off', onSaveDraft, onCancelDraft })}
      />,
    );
    const textarea = document.querySelector('.iframe-review-popover--draft .iframe-review-textarea') as HTMLTextAreaElement;
    act(() => {
      textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', metaKey: true, bubbles: true }));
    });
    expect(onSaveDraft).toHaveBeenCalledTimes(1);

    act(() => {
      textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(onCancelDraft).toHaveBeenCalledTimes(1);
  });

  it('Add is disabled with an empty draft; Cancel calls onCancelDraft', () => {
    const onCancelDraft = vi.fn();
    render(
      <IframeReviewLayer {...baseProps({ draftSelection: SELECTION, draftText: '', onCancelDraft })} />,
    );
    const buttons = Array.from(
      document.querySelectorAll('.iframe-review-popover--draft .iframe-review-mini-btn'),
    ) as HTMLButtonElement[];
    const addBtn = buttons.find((b) => b.textContent === 'Add')!;
    const cancelBtn = buttons.find((b) => b.textContent === 'Cancel')!;
    expect(addBtn.disabled).toBe(true);

    act(() => {
      cancelBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(onCancelDraft).toHaveBeenCalledTimes(1);
  });

  it('Add is enabled once the draft has text and calls onSaveDraft', () => {
    const onSaveDraft = vi.fn();
    render(
      <IframeReviewLayer
        {...baseProps({ draftSelection: SELECTION, draftText: 'add a note', onSaveDraft })}
      />,
    );
    const addBtn = Array.from(
      document.querySelectorAll('.iframe-review-popover--draft .iframe-review-mini-btn'),
    ).find((b) => b.textContent === 'Add') as HTMLButtonElement;
    expect(addBtn.disabled).toBe(false);
    act(() => {
      addBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(onSaveDraft).toHaveBeenCalledTimes(1);
  });

  it('clicking a pin opens its popover; Close hides it and Delete calls onRemoveComment', () => {
    const onRemoveComment = vi.fn();
    render(<IframeReviewLayer {...baseProps({ comments: [COMMENT], onRemoveComment })} />);
    expect(document.querySelector('.iframe-review-popover:not(.iframe-review-popover--draft)')).toBeNull();

    const pin = document.querySelector('.iframe-review-pin') as HTMLButtonElement;
    act(() => {
      pin.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    const popover = document.querySelector('.iframe-review-popover:not(.iframe-review-popover--draft)');
    expect(popover).not.toBeNull();

    const actionButtons = Array.from(popover!.querySelectorAll('.iframe-review-mini-btn')) as HTMLButtonElement[];
    const deleteBtn = actionButtons.find((b) => b.textContent === 'Delete')!;
    act(() => {
      deleteBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(onRemoveComment).toHaveBeenCalledWith('review-1');
  });

  it('pending bar: Clear calls onClear, Send to Chat calls onSubmit when a comment has text', () => {
    const onClear = vi.fn();
    const onSubmit = vi.fn();
    render(<IframeReviewLayer {...baseProps({ comments: [COMMENT], onClear, onSubmit })} />);
    const bar = document.querySelector('.iframe-review-pending-bar');
    expect(bar?.textContent).toContain('1 review comment');

    const buttons = Array.from(bar!.querySelectorAll('.iframe-review-mini-btn')) as HTMLButtonElement[];
    const clearBtn = buttons.find((b) => b.textContent === 'Clear')!;
    const sendBtn = buttons.find((b) => b.textContent?.includes('Send'))!;
    expect(sendBtn.disabled).toBe(false);

    act(() => {
      sendBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(onSubmit).toHaveBeenCalledTimes(1);

    act(() => {
      clearBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(onClear).toHaveBeenCalledTimes(1);
  });
});
