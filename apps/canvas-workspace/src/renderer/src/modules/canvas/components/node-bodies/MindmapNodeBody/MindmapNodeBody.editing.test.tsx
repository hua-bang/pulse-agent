// @vitest-environment happy-dom
import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { I18nProvider } from '../../../../../i18n';
import type { CanvasNode, MindmapNodeData, MindmapTopic } from '../../../../../types';
import { MindmapNodeBody } from '.';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const topic = (id: string, text: string, children: MindmapTopic[] = []): MindmapTopic => ({
  id,
  text,
  children,
});

const initialNode: CanvasNode = {
  id: 'map',
  type: 'mindmap',
  title: 'Root',
  x: 0,
  y: 100,
  width: 360,
  height: 200,
  data: {
    root: topic('root', 'Root', [topic('a', 'Alpha'), topic('b', 'Beta')]),
    layout: 'right',
    rev: 0,
  } satisfies MindmapNodeData,
};

let latest: CanvasNode = initialNode;

const Harness = () => {
  const [node, setNode] = useState(initialNode);
  latest = node;
  return (
    <I18nProvider>
      <MindmapNodeBody
        node={node}
        isSelected
        onUpdate={(_id, patch) => setNode((current) => ({ ...current, ...patch }))}
        onSelectNode={() => undefined}
        onAutoResize={(_id, width, height, x, y) =>
          setNode((current) => ({ ...current, width, height, x: x ?? current.x, y: y ?? current.y }))}
      />
    </I18nProvider>
  );
};

const pill = (id: string) => document.querySelector<HTMLElement>(`[data-topic-id="${id}"]`)!;
const topicIds = () => [...document.querySelectorAll('[data-topic-id]')].map((el) => el.getAttribute('data-topic-id'));
const press = (key: string) => {
  const target = document.activeElement ?? document.body;
  act(() => {
    target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
  });
};
/** Canvas y of the root topic: node top + padding + root offset. */
const rootCanvasY = () => latest.y + Number(/translate\([^,]+,\s*([-\d.]+)px/.exec(pill('root').style.transform)![1]);

describe('MindmapNodeBody editing', () => {
  let root: Root;
  let host: HTMLElement;

  beforeEach(() => {
    latest = initialNode;
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => root.render(<Harness />));
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  it('keeps the root still on the canvas when a branch grows', () => {
    const before = rootCanvasY();
    act(() => pill('b').dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 })));
    press('Enter');
    const editor = document.activeElement as HTMLElement;
    act(() => {
      editor.innerText = 'Gamma';
      editor.dispatchEvent(new Event('input', { bubbles: true }));
    });
    press('Enter');
    expect(topicIds()).toHaveLength(4);
    expect(rootCanvasY()).toBe(before);
  });

  it('cancels a new topic that is left empty', () => {
    act(() => pill('a').dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 })));
    press('Tab');
    expect(topicIds()).toHaveLength(4);
    press('Escape');
    expect(topicIds()).toEqual(['root', 'a', 'b']);
  });

  it('makes room for text while it is typed', () => {
    act(() => pill('a').dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 })));
    press('F2');
    const before = Number.parseFloat(pill('a').style.width);
    const editor = pill('a').querySelector<HTMLElement>('.mindmap-topic-text')!;
    act(() => {
      editor.innerText = 'Alpha with a much longer label';
      editor.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(Number.parseFloat(pill('a').style.width)).toBeGreaterThan(before);
  });
});
