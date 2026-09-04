// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import type { AgentContextDomReviewComment, AgentRequestContext } from '../../../../../types';
import { useSubmitDomReviewComments } from '../useSubmitDomReviewComments';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const COMMENT: AgentContextDomReviewComment = {
  id: 'review-1',
  text: 'Increase contrast',
  selection: { id: 'dom-1', label: 'Button', nodeId: 'node-1', selector: '#button' },
};

describe('useSubmitDomReviewComments', () => {
  it('sends valid comments with their DOM selections merged into context', async () => {
    const host = document.createElement('div');
    const root = createRoot(host);
    const sendMessage = vi.fn(async () => true);
    const focusInput = vi.fn();
    const openModelSettingsWithHint = vi.fn();
    const requestContext: AgentRequestContext = {
      scope: 'current_canvas',
      domSelections: [{ id: 'existing', label: 'Existing', nodeId: 'node-0', selector: '#existing' }],
    };
    let submit: ((comments: AgentContextDomReviewComment[]) => Promise<boolean>) | undefined;
    const Harness = () => {
      submit = useSubmitDomReviewComments({
        blocked: false,
        focusInput,
        notConfigured: false,
        openModelSettingsWithHint,
        requestContext,
        sendMessage,
      });
      return null;
    };

    act(() => root.render(<Harness />));
    const sent = await act(async () => await submit?.([COMMENT]));

    expect(sent).toBe(true);
    expect(sendMessage).toHaveBeenCalledWith(
      expect.stringContaining('Increase contrast'),
      expect.objectContaining({
        scope: 'selected_nodes',
        domSelections: [requestContext.domSelections![0], COMMENT.selection],
      }),
    );
    expect(focusInput).not.toHaveBeenCalled();
    expect(openModelSettingsWithHint).not.toHaveBeenCalled();

    act(() => root.unmount());
  });

  it('keeps invalid, blocked, and unconfigured reviews out of the send path', async () => {
    const host = document.createElement('div');
    const root = createRoot(host);
    const sendMessage = vi.fn(async () => true);
    const focusInput = vi.fn();
    const openModelSettingsWithHint = vi.fn();
    let submit: ((comments: AgentContextDomReviewComment[]) => Promise<boolean>) | undefined;
    const Harness = ({ blocked = false, notConfigured = false }) => {
      submit = useSubmitDomReviewComments({
        blocked,
        focusInput,
        notConfigured,
        openModelSettingsWithHint,
        requestContext: { scope: 'current_canvas' },
        sendMessage,
      });
      return null;
    };

    act(() => root.render(<Harness />));
    expect(await act(async () => await submit?.([{ ...COMMENT, text: '  ' }]))).toBe(false);
    expect(focusInput).toHaveBeenCalledOnce();

    act(() => root.render(<Harness notConfigured />));
    expect(await act(async () => await submit?.([COMMENT]))).toBe(false);
    expect(openModelSettingsWithHint).toHaveBeenCalledOnce();

    act(() => root.render(<Harness blocked />));
    expect(await act(async () => await submit?.([COMMENT]))).toBe(false);
    expect(sendMessage).not.toHaveBeenCalled();

    act(() => root.unmount());
  });
});
