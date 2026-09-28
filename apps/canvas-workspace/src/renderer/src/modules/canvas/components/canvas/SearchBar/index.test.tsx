// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CanvasNode } from '../../../../../types';
import { I18nProvider } from '../../../../../i18n';
import { useCanvasSearch, type UseCanvasSearchReturn } from '../../../runtime/useCanvasSearch';
import { CANVAS_FIND_DEBOUNCE_MS, SearchBar } from './index';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const textNode = (id: string, y: number, content: string): CanvasNode => ({
  id, type: 'text', title: id, x: 0, y, width: 200, height: 100,
  data: { content, textColor: '', backgroundColor: '' },
});

const nodes = [textNode('first', 0, 'alpha one'), textNode('second', 100, 'alpha two')];
const nodesById = new Map(nodes.map(node => [node.id, node]));

describe('SearchBar', () => {
  let host: HTMLDivElement;
  let root: Root;
  let search: UseCanvasSearchReturn;
  let renders = 0;
  const onActivateMatch = vi.fn();

  const Probe = () => {
    renders++;
    search = useCanvasSearch({ nodes });
    return <SearchBar search={search} nodesById={nodesById} onActivateMatch={onActivateMatch} />;
  };

  const input = () => host.querySelector<HTMLInputElement>('.canvas-search-bar__input')!;
  const type = (value: string) => act(() => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    setter.call(input(), value);
    input().dispatchEvent(new Event('input', { bubbles: true }));
  });
  const press = (key: string) => act(() => {
    input().dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
  });

  beforeEach(() => {
    vi.useFakeTimers();
    renders = 0;
    onActivateMatch.mockClear();
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => root.render(<I18nProvider><Probe /></I18nProvider>));
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    vi.useRealTimers();
  });

  it('commits typed text to the canvas scan once per quiet period', () => {
    const rendersBeforeTyping = renders;
    type('a');
    type('al');
    type('alp');

    expect(input().value).toBe('alp');
    expect(search.query).toBe('');
    expect(renders).toBe(rendersBeforeTyping);

    act(() => vi.advanceTimersByTime(CANVAS_FIND_DEBOUNCE_MS));

    expect(search.query).toBe('alp');
    expect(search.matches.map(match => match.nodeId)).toEqual(['first', 'second']);
  });

  it('commits a pending draft on Enter and lands on its first match', () => {
    type('alpha');
    act(() => vi.advanceTimersByTime(CANVAS_FIND_DEBOUNCE_MS));
    press('Enter');
    expect(search.activeIndex).toBe(1);

    type('alpha t');
    press('Enter');

    expect(search.query).toBe('alpha t');
    expect(search.matches.map(match => match.nodeId)).toEqual(['second']);
    expect(search.activeIndex).toBe(0);
  });
});
