// @vitest-environment happy-dom
import { act, lazy } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ChatClarificationCard } from './index';
import { I18nProvider } from '../../../../../i18n';
import type { CanvasNode } from '../../../../../types';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const failedImport = lazy(async () => { throw new Error('Preview chunk unavailable'); });
vi.mock('../../../../canvas/preview', () => ({
  CanvasApprovalNodePreview: ({ node }: { node: CanvasNode }) => {
    if (node.title === 'render failure') throw new Error('Preview render failed');
    const FailedImport = failedImport;
    if (node.title === 'import failure') return <FailedImport />;
    return <div>Loaded preview</div>;
  },
}));

let host: HTMLDivElement;
let root: Root;
const onAnswer = vi.fn().mockResolvedValue(undefined);
const render = async (title: string, id = 'approval-1', disabled = false) => {
  await act(async () => root.render(
    <I18nProvider>
      <ChatClarificationCard
        pendingClarify={{
          id, kind: 'approval', question: 'Create this image?', context: 'Tool arguments', defaultAnswer: 'No',
          nodePreview: { id, type: 'image', title, x: 0, y: 0, width: 100, height: 100, data: { filePath: '/tmp/image.png' } },
        }}
        clarifyInput=""
        answering={false}
        disabled={disabled}
        error={null}
        onInputChange={vi.fn()}
        onAnswer={onAnswer}
      />
    </I18nProvider>,
  ));
};

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  onAnswer.mockClear();
  // React reports caught errors to the console in development.
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.restoreAllMocks();
});

describe('approval preview containment', () => {
  it.each(['render failure', 'import failure'])('retains details and working decisions after %s', async (failure) => {
    await render(failure);
    expect(host.textContent).toContain('Preview unavailable');
    expect(host.textContent).toContain('Create this image?');
    expect(host.querySelector('details')?.textContent).toContain('Tool arguments');
    expect(onAnswer).not.toHaveBeenCalled();
    const buttons = [...host.querySelectorAll('button')];
    expect(buttons.map(button => button.textContent)).toEqual(['Approve', 'Reject']);
    await act(async () => buttons[0].click());
    await act(async () => buttons[1].click());
    expect(onAnswer.mock.calls).toEqual([['Yes'], ['No']]);
  });

  it('resets preview failure for the next approval', async () => {
    await render('render failure');
    await render('valid image', 'approval-2');
    expect(host.textContent).toContain('Loaded preview');
    expect(host.textContent).not.toContain('Preview unavailable');
  });

  it('keeps disabled approval controls disabled after a preview failure', async () => {
    await render('render failure', 'approval-1', true);
    expect([...host.querySelectorAll('button')].every(button => button.disabled)).toBe(true);
    expect(onAnswer).not.toHaveBeenCalled();
  });
});
