// @vitest-environment happy-dom
import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { TextField } from '../TextField';

let root: Root | null = null;
let host: HTMLDivElement | null = null;

afterEach(() => {
  if (root) flushSync(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
});

function render(node: React.ReactNode) {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  flushSync(() => {
    root?.render(node);
  });
}

describe('TextField', () => {
  it('renders an input element by default', () => {
    render(<TextField label="Name" />);
    expect(host?.querySelector('input.ui-textfield__control')).toBeInstanceOf(HTMLInputElement);
    expect(host?.querySelector('textarea')).toBeNull();
  });

  it('renders a textarea element when multiline', () => {
    render(<TextField label="Notes" multiline />);
    expect(host?.querySelector('textarea.ui-textfield__control')).toBeInstanceOf(HTMLTextAreaElement);
    expect(host?.querySelector('input')).toBeNull();
  });

  it('renders label and hint copy', () => {
    render(<TextField label="Name" hint="Helper text" />);
    expect(host?.querySelector('.ui-textfield__label')?.textContent).toBe('Name');
    expect(host?.querySelector('.ui-textfield__hint')?.textContent).toBe('Helper text');
  });

  it('omits label/hint elements when not provided', () => {
    render(<TextField />);
    expect(host?.querySelector('.ui-textfield__label')).toBeNull();
    expect(host?.querySelector('.ui-textfield__hint')).toBeNull();
  });

  it('links the hint to the control via aria-describedby', () => {
    render(<TextField label="Name" hint="Helper text" />);
    const control = host?.querySelector('.ui-textfield__control') as HTMLElement;
    const hint = host?.querySelector('.ui-textfield__hint') as HTMLElement;
    expect(hint.id).toBeTruthy();
    expect(control.getAttribute('aria-describedby')).toBe(hint.id);
  });

  it('does not set aria-describedby when there is no hint', () => {
    render(<TextField label="Name" />);
    const control = host?.querySelector('.ui-textfield__control') as HTMLElement;
    expect(control.hasAttribute('aria-describedby')).toBe(false);
  });

  it('merges className onto the control', () => {
    render(<TextField label="Name" className="cfg-input" />);
    const control = host?.querySelector('.ui-textfield__control');
    expect(control?.classList.contains('ui-textfield__control')).toBe(true);
    expect(control?.classList.contains('cfg-input')).toBe(true);
  });

  it('merges className onto the textarea control when multiline', () => {
    render(<TextField label="Notes" multiline className="cfg-textarea" />);
    const control = host?.querySelector('.ui-textfield__control');
    expect(control?.tagName).toBe('TEXTAREA');
    expect(control?.classList.contains('cfg-textarea')).toBe(true);
  });
});
