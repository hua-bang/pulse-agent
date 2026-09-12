// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { useDockReadingLayout } from '../useDockReadingLayout';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let mount: HTMLDivElement;
let app: HTMLDivElement;
let state: ReturnType<typeof useDockReadingLayout>;
const Probe = (props: { scope: string; split?: boolean; visible?: boolean }) => {
  state = useDockReadingLayout({ scope: props.scope, split: props.split ?? false, visible: props.visible ?? true,
    availableWidth: 1200, sideWidth: 480, hasContent: true });
  return null;
};
const render = (scope = 'canvas:a', split = false, visible = true) => act(() => root.render(<Probe scope={scope} split={split} visible={visible} />));
afterEach(() => { act(() => root?.unmount()); mount?.remove(); app?.remove(); });
const setup = () => {
  mount = document.createElement('div'); document.body.appendChild(mount); root = createRoot(mount);
  app = document.createElement('div'); app.className = 'app-body';
  app.innerHTML = '<aside class="sidebar"></aside><main><textarea>keep draft</textarea></main>';
  document.body.appendChild(app); render();
};

describe('reading promotion', () => {
  it('expands without changing the preferred side width and restores keyboard access on return', () => {
    setup();
    const main = app.querySelector('main')!;
    const draft = main.querySelector('textarea')!;
    const beforeInert = main.inert;
    act(() => state.setMode('reading'));
    expect(state.width).toBe(1200);
    expect(main.inert).toBe(true);
    expect(app.querySelector('aside')!.inert).not.toBe(true);
    act(() => state.setMode('side'));
    expect(state.width).toBe(480);
    expect(main.inert).toBe(beforeInert);
    expect(main.querySelector('textarea')).toBe(draft);
    expect(draft.value).toBe('keep draft');
  });
  it('opens comparison wide, restores side width on exit and keeps a manually expanded reader expanded', () => {
    setup(); render('canvas:a', true);
    expect(state.width).toBe(1200);
    render(); expect(state.width).toBe(480);
    act(() => state.setMode('reading'));
    render('canvas:a', true); render();
    expect(state.width).toBe(1200);
  });
  it('expands full-page chat reading and resets promotion on a different route or scope', () => {
    setup(); render('chat:a');
    act(() => state.setMode('reading'));
    expect(state.width).toBe(1200);
    expect(document.documentElement.dataset.dockReading).toBe('reading');
    render('chat:b'); expect(state.expanded).toBe(false);
    render('canvas:b'); expect(state.width).toBe(480);
  });
  it('collapsing clears reading mode instead of reopening a hidden full-workspace overlay', () => {
    setup(); act(() => state.setMode('reading'));
    render('canvas:a', false, false); render();
    expect(state.expanded).toBe(false);
  });
});
