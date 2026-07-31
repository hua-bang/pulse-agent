// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { DockTabIcon } from '../DockTabIcon';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let mount: HTMLDivElement | null = null;

afterEach(() => {
  act(() => root?.unmount());
  mount?.remove();
  root = null;
  mount = null;
});

describe('DockTabIcon', () => {
  it('uses one icon slot for brand, favicon, agent and content marks', () => {
    mount = document.createElement('div');
    document.body.appendChild(mount);
    root = createRoot(mount);

    act(() => root?.render(
      <>
        <DockTabIcon kind="chat" />
        <DockTabIcon kind="link" faviconUrl="https://example.com/favicon.ico" />
        <DockTabIcon kind="terminal" agentType="codex" />
        <DockTabIcon kind="node-detail" />
        <DockTabIcon kind="canvas" />
      </>,
    ));

    const slots = [...mount.querySelectorAll('.right-dock__tab-icon')];
    expect(slots).toHaveLength(5);
    expect(slots.every((slot) => slot.getAttribute('aria-hidden') === 'true')).toBe(true);
    expect(mount.querySelector('.right-dock__tab-icon--chat img')).toBeTruthy();
    expect(mount.querySelector<HTMLImageElement>('.right-dock__tab-favicon')?.src)
      .toBe('https://example.com/favicon.ico');
    expect(mount.querySelector('.right-dock__tab-icon--agent-codex svg')).toBeTruthy();
    expect(mount.querySelector('.right-dock__tab-icon--node-detail svg')).toBeTruthy();
    expect(mount.querySelector('.right-dock__tab-dot--canvas')).toBeTruthy();
  });
});
