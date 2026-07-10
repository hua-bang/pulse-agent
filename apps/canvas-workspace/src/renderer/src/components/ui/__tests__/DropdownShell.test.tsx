// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DropdownShell } from '../DropdownShell';

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

const basicTrigger = ({ open, toggle }: { open: boolean; toggle: () => void }) => (
  <button type="button" className="trigger" aria-expanded={open} onClick={toggle}>
    Open
  </button>
);

const click = (el: Element) => {
  act(() => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  });
};

describe('DropdownShell', () => {
  it('is closed by default and opens on trigger click', () => {
    render(
      <DropdownShell trigger={basicTrigger}>
        <button type="button">Item</button>
      </DropdownShell>,
    );
    expect(host?.querySelector('.ui-dropdown__panel')).toBeNull();

    click(host!.querySelector('.trigger')!);
    expect(host?.querySelector('.ui-dropdown__panel')).not.toBeNull();
  });

  it('toggles closed on a second trigger click', () => {
    render(
      <DropdownShell trigger={basicTrigger}>
        <button type="button">Item</button>
      </DropdownShell>,
    );
    const trigger = host!.querySelector('.trigger')!;
    click(trigger);
    expect(host?.querySelector('.ui-dropdown__panel')).not.toBeNull();
    click(trigger);
    expect(host?.querySelector('.ui-dropdown__panel')).toBeNull();
  });

  it('closes on an outside press', () => {
    render(
      <DropdownShell trigger={basicTrigger}>
        <button type="button">Item</button>
      </DropdownShell>,
    );
    click(host!.querySelector('.trigger')!);
    expect(host?.querySelector('.ui-dropdown__panel')).not.toBeNull();

    act(() => {
      document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    });
    expect(host?.querySelector('.ui-dropdown__panel')).toBeNull();
  });

  it('closes on Escape', () => {
    render(
      <DropdownShell trigger={basicTrigger}>
        <button type="button">Item</button>
      </DropdownShell>,
    );
    click(host!.querySelector('.trigger')!);
    expect(host?.querySelector('.ui-dropdown__panel')).not.toBeNull();

    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    });
    expect(host?.querySelector('.ui-dropdown__panel')).toBeNull();
  });

  it('applies placement and align modifier classes', () => {
    render(
      <DropdownShell trigger={basicTrigger} placement="top" align="end">
        <button type="button">Item</button>
      </DropdownShell>,
    );
    click(host!.querySelector('.trigger')!);
    const panel = host?.querySelector('.ui-dropdown__panel');
    expect(panel?.classList.contains('ui-dropdown--top')).toBe(true);
    expect(panel?.classList.contains('ui-dropdown--align-end')).toBe(true);
  });

  it('defaults to bottom/start placement classes', () => {
    render(
      <DropdownShell trigger={basicTrigger}>
        <button type="button">Item</button>
      </DropdownShell>,
    );
    click(host!.querySelector('.trigger')!);
    const panel = host?.querySelector('.ui-dropdown__panel');
    expect(panel?.classList.contains('ui-dropdown--bottom')).toBe(true);
    expect(panel?.classList.contains('ui-dropdown--align-start')).toBe(true);
  });

  it('forwards ariaLabel to the panel so role="menu" is not unnamed', () => {
    render(
      <DropdownShell trigger={basicTrigger} ariaLabel="Shape style">
        <button type="button">Item</button>
      </DropdownShell>,
    );
    click(host!.querySelector('.trigger')!);
    const panel = host?.querySelector('.ui-dropdown__panel');
    expect(panel?.getAttribute('aria-label')).toBe('Shape style');
  });

  it('calls onOpenChange with the new open state', () => {
    const onOpenChange = vi.fn();
    render(
      <DropdownShell trigger={basicTrigger} onOpenChange={onOpenChange}>
        <button type="button">Item</button>
      </DropdownShell>,
    );
    click(host!.querySelector('.trigger')!);
    expect(onOpenChange).toHaveBeenLastCalledWith(true);
    click(host!.querySelector('.trigger')!);
    expect(onOpenChange).toHaveBeenLastCalledWith(false);
  });

  it('adds the ui-dropdown--open modifier to the root while open', () => {
    render(
      <DropdownShell trigger={basicTrigger} className="frame-color-trigger">
        <button type="button">Item</button>
      </DropdownShell>,
    );
    const dropdownRoot = host?.querySelector('.frame-color-trigger') as HTMLElement;
    expect(dropdownRoot.classList.contains('ui-dropdown--open')).toBe(false);
    click(host!.querySelector('.trigger')!);
    expect(dropdownRoot.classList.contains('ui-dropdown--open')).toBe(true);
  });

  it('passes close() to function children so an item pick can dismiss the panel', () => {
    render(
      <DropdownShell trigger={basicTrigger}>
        {({ close }) => (
          <button type="button" className="pick" onClick={close}>
            Pick
          </button>
        )}
      </DropdownShell>,
    );
    click(host!.querySelector('.trigger')!);
    expect(host?.querySelector('.ui-dropdown__panel')).not.toBeNull();
    click(host!.querySelector('.pick')!);
    expect(host?.querySelector('.ui-dropdown__panel')).toBeNull();
  });

  it('swallows mousedown across the whole panel surface and runs onPanelMouseDown first', () => {
    // The pre-migration wrappers guarded padding/gaps too — a press inside
    // the panel must never leak to canvas selection/drag handlers upstream.
    const parentMouseDown = vi.fn();
    const onPanelMouseDown = vi.fn();
    render(
      <div onMouseDown={parentMouseDown}>
        <DropdownShell trigger={basicTrigger} onPanelMouseDown={onPanelMouseDown}>
          <button type="button">Item</button>
        </DropdownShell>
      </div>,
    );
    click(host!.querySelector('.trigger')!);
    const panel = host?.querySelector('.ui-dropdown__panel') as HTMLElement;
    act(() => {
      panel.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    });
    expect(onPanelMouseDown).toHaveBeenCalledTimes(1);
    expect(parentMouseDown).not.toHaveBeenCalled();
  });
});
