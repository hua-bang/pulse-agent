// @vitest-environment happy-dom
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { WorkspaceNodeListItem } from '../../../../../types';
import { I18nProvider } from '../../../../../i18n';
import { GraphSearch } from '.';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLDivElement | null = null;

afterEach(() => {
  if (root) act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
});

const NODES: WorkspaceNodeListItem[] = [
  {
    workspaceId: 'ws-1',
    workspaceName: 'Workspace One',
    id: 'node-1',
    type: 'text',
    title: 'Alpha note',
    tags: [],
    hasData: true,
    linkCount: 0,
  },
  {
    workspaceId: 'ws-1',
    workspaceName: 'Workspace One',
    id: 'node-2',
    type: 'text',
    title: 'Beta note',
    tags: [],
    hasData: true,
    linkCount: 0,
  },
];

function render(node: ReactNode) {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => {
    root?.render(<I18nProvider>{node}</I18nProvider>);
  });
}

function openSearch() {
  act(() => {
    window.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'f',
      metaKey: true,
      bubbles: true,
      cancelable: true,
    }));
  });
}

function setQuery(value: string) {
  const input = host!.querySelector('input') as HTMLInputElement;
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  return input;
}

describe('GraphSearch', () => {
  it('opens from the graph search shortcut and closes from Escape', () => {
    render(<GraphSearch nodes={NODES} tags={[]} showTags onPick={vi.fn()} />);

    expect(host?.querySelector('[role="combobox"]')).toBeNull();
    openSearch();
    const input = host?.querySelector('[role="combobox"]');
    expect(input).not.toBeNull();

    act(() => {
      input?.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'Escape',
        bubbles: true,
        cancelable: true,
      }));
    });
    expect(host?.querySelector('[role="combobox"]')).toBeNull();
  });

  it('moves through results with arrows and picks the active result on Enter', () => {
    const onPick = vi.fn();
    render(<GraphSearch nodes={NODES} tags={[]} showTags onPick={onPick} />);
    openSearch();
    const input = setQuery('note');

    expect(host?.querySelectorAll('[role="option"]')).toHaveLength(2);
    act(() => {
      input.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'ArrowDown',
        bubbles: true,
        cancelable: true,
      }));
    });
    act(() => {
      input.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'Enter',
        bubbles: true,
        cancelable: true,
      }));
    });

    expect(onPick).toHaveBeenCalledWith({ kind: 'node', node: NODES[1] });
    expect(host?.querySelector('[role="combobox"]')).toBeNull();
  });

  it('does not pick a result while an IME composition is active', () => {
    const onPick = vi.fn();
    render(<GraphSearch nodes={NODES} tags={[]} showTags onPick={onPick} />);
    openSearch();
    const input = setQuery('alpha');
    const event = new KeyboardEvent('keydown', {
      key: 'Enter',
      bubbles: true,
      cancelable: true,
    });
    Object.defineProperty(event, 'isComposing', { value: true });

    act(() => {
      input.dispatchEvent(event);
    });

    expect(onPick).not.toHaveBeenCalled();
    expect(host?.querySelector('[role="combobox"]')).not.toBeNull();
  });
});
