// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../../../../../../i18n';
import { NodeCreationGroup } from './index';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLDivElement | null = null;

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
});

describe('NodeCreationGroup', () => {
  it('maps each visible creation action to its canvas node type', () => {
    const onAddNode = vi.fn();
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);

    act(() => {
      root?.render(
        <I18nProvider>
          <NodeCreationGroup
            terminalDockOpen={false}
            showTerminalAdd={false}
            onAddNode={onAddNode}
            onTerminalToggle={vi.fn()}
            onNewTerminal={vi.fn()}
          />
        </I18nProvider>,
      );
    });

    for (const label of [
      'Add Text',
      'Add Note Card',
      'Add Frame',
      'Add Web Page',
      'Add Coding Agent',
      'Add Mindmap',
    ]) {
      const button = host.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
      expect(button, label).not.toBeNull();
      act(() => button?.click());
    }

    expect(onAddNode.mock.calls.map(([type]) => type)).toEqual([
      'text',
      'file',
      'frame',
      'iframe',
      'agent',
      'mindmap',
    ]);
  });
});
