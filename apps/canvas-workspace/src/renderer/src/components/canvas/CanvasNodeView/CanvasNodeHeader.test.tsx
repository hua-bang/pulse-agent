// @vitest-environment happy-dom
import { createRef } from 'react';
import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../../../i18n';
import type { CanvasNode } from '../../../types';
import { CanvasNodeHeader } from './CanvasNodeHeader';

const node = {
  id: 'terminal-1',
  type: 'terminal',
  title: 'A complete title that may be visually truncated',
  x: 10,
  y: 20,
  width: 320,
  height: 240,
  data: {},
} as CanvasNode;

let host: HTMLDivElement | null = null;
let root: Root | null = null;

afterEach(() => {
  root?.unmount();
  host?.remove();
  root = null;
  host = null;
});

describe('CanvasNodeHeader title', () => {
  it('exposes the full title and keyboard editing entry without changing double-click behavior', () => {
    const handleTitleDoubleClick = vi.fn();
    const handleTitleKeyDown = vi.fn();
    renderHeader({
      handleTitleDoubleClick,
      handleTitleKeyDown,
    });

    const title = host?.querySelector('.node-title') as HTMLSpanElement;
    expect(title.tabIndex).toBe(0);
    expect(title.getAttribute('role')).toBe('button');
    expect(title.getAttribute('aria-keyshortcuts')).toBe('Enter F2');
    expect(title.getAttribute('aria-label')).toBe(
      'Edit node title: A complete title that may be visually truncated',
    );
    expect(title.getAttribute('title')).toBe(node.title);

    title.dispatchEvent(new globalThis.KeyboardEvent('keydown', {
      key: 'F2',
      bubbles: true,
      cancelable: true,
    }));
    title.dispatchEvent(new globalThis.MouseEvent('dblclick', {
      bubbles: true,
      cancelable: true,
    }));

    expect(handleTitleKeyDown).toHaveBeenCalledTimes(1);
    expect(handleTitleDoubleClick).toHaveBeenCalledTimes(1);
  });

  it('wires paste handling only while the single-line title textbox is active', () => {
    const handleTitlePaste = vi.fn();
    renderHeader({
      handleTitlePaste,
      isEditingTitle: true,
    });

    const title = host?.querySelector('.node-title') as HTMLSpanElement;
    expect(title.getAttribute('role')).toBe('textbox');
    expect(title.getAttribute('aria-multiline')).toBe('false');
    expect(title.getAttribute('aria-keyshortcuts')).toBeNull();
    expect(title.getAttribute('title')).toBeNull();

    const event = new globalThis.Event('paste', {
      bubbles: true,
      cancelable: true,
    });
    Object.defineProperty(event, 'clipboardData', {
      value: { getData: () => 'First\nSecond' },
    });
    title.dispatchEvent(event);

    expect(handleTitlePaste).toHaveBeenCalledTimes(1);
  });

  it('does not put a readonly title in the tab order', () => {
    renderHeader({ readOnly: true });

    const title = host?.querySelector('.node-title') as HTMLSpanElement;
    expect(title.tabIndex).toBe(-1);
    expect(title.getAttribute('role')).toBeNull();
    expect(title.getAttribute('aria-label')).toBeNull();
  });

  it('uses preview-specific copy for the standard source action icon', () => {
    renderHeader({
      focusAction: {
        ariaLabel: 'Open source',
        title: 'Open source',
      },
    });

    const action = host?.querySelector('.node-focus') as HTMLButtonElement;
    expect(action.getAttribute('aria-label')).toBe('Open source');
    expect(action.getAttribute('title')).toBe('Open source');
  });
});

function renderHeader(overrides: Partial<Parameters<typeof CanvasNodeHeader>[0]> = {}) {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);

  flushSync(() => {
    root?.render(
      <I18nProvider>
        <CanvasNodeHeader
          fullscreenButton={null}
          containerDescendantCount={0}
          handleClose={vi.fn()}
          handleFocus={vi.fn()}
          handleHeaderMouseDown={vi.fn()}
          handlePluginSelectElement={vi.fn()}
          handleOpenDetail={vi.fn()}
          handleOpenTab={vi.fn()}
          handleAddToChat={vi.fn()}
          handleAddToCanvas={vi.fn()}
          handleTitleBlur={vi.fn()}
          handleTitleDoubleClick={vi.fn()}
          handleTitleKeyDown={vi.fn()}
          handleTitlePaste={vi.fn()}
          handleUngroup={vi.fn()}
          isEditingTitle={false}
          isFullscreen={false}
          isSelected
          node={node}
          pluginElementPickerActive={false}
          canOpenTab={false}
          onUpdate={vi.fn()}
          readOnly={false}
          relativeTime={null}
          titleRef={createRef<HTMLSpanElement>()}
          {...overrides}
        />
      </I18nProvider>,
    );
  });
}
