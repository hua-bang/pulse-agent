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
      'Add Mindmap',
      'Add Frame',
      'Add Web Page',
      'Add Coding Agent',
    ]) {
      const button = host.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
      expect(button, label).not.toBeNull();
      act(() => button?.click());
    }

    expect(onAddNode.mock.calls.map(([type]) => type)).toEqual([
      'text',
      'file',
      'mindmap',
      'frame',
      'iframe',
      'agent',
    ]);
  });

  it('offers the same creation actions from the compact add menu', () => {
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

    const trigger = host.querySelector<HTMLButtonElement>('.toolbar-create-compact button[aria-label="Add node"]');
    expect(trigger).not.toBeNull();
    act(() => trigger?.click());

    const items = [...host.querySelectorAll<HTMLButtonElement>('.toolbar-create-menu [role="menuitem"]')];
    expect(items.map((item) => item.getAttribute('aria-label'))).toEqual([
      'Add Text',
      'Add Note Card',
      'Add Mindmap',
      'Add Frame',
      'Add Web Page',
      'Add Coding Agent',
    ]);

    act(() => items[2]?.click());
    expect(onAddNode).toHaveBeenCalledWith('mindmap');
    expect(host.querySelector('.toolbar-create-menu')).toBeNull();
  });
});
