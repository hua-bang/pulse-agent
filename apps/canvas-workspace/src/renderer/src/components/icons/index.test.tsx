// @vitest-environment happy-dom
import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { NodeTypeIcon } from './index';

let root: Root | null = null;
let mount: HTMLDivElement | null = null;

afterEach(() => {
  flushSync(() => root?.unmount());
  mount?.remove();
  root = null;
  mount = null;
});

const renderIcon = (type: Parameters<typeof NodeTypeIcon>[0]['type'], colorize = false) => {
  mount = document.createElement('div');
  document.body.appendChild(mount);
  root = createRoot(mount);
  flushSync(() => root?.render(<NodeTypeIcon type={type} colorize={colorize} />));
  return mount.querySelector('svg')!;
};

describe('NodeTypeIcon', () => {
  it('uses the reference geometry for the core canvas creation icons', () => {
    const note = renderIcon('file');
    expect(note.getAttribute('viewBox')).toBe('0 0 18 18');
    expect(note.querySelector('rect')?.getAttribute('x')).toBe('3');
    expect(note.querySelectorAll('path')).toHaveLength(1);

    const terminal = renderIcon('terminal');
    expect(terminal.querySelector('rect')?.getAttribute('x')).toBe('2.5');

    const frame = renderIcon('frame');
    expect(frame.querySelector('rect[stroke-dasharray]')).not.toBeNull();
  });

  it('stays monochrome by default and exposes opt-in semantic color classes', () => {
    const defaultIcon = renderIcon('terminal');
    expect(defaultIcon.getAttribute('class')).toBe('canvas-node-icon');

    const coloredIcon = renderIcon('terminal', true);
    expect(coloredIcon.getAttribute('class')).toBe('canvas-node-icon canvas-node-icon--colorized canvas-node-icon--terminal');
  });
});
