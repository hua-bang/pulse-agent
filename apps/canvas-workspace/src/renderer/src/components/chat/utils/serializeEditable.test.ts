import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { serializeEditable } from './serializeEditable';

/**
 * serializeEditable walks a contentEditable subtree. It only touches a few DOM
 * features (Node.TEXT_NODE, instanceof HTMLElement, childNodes, dataset,
 * tagName, textContent), so instead of pulling in jsdom we shim the two globals
 * it reads and build fake nodes that mirror what the browser produces — in
 * particular the <div>-per-line structure Chromium creates when multi-line text
 * is pasted into an empty editable.
 */
class FakeElement {
  nodeType = 1;
  textContent = '';
  constructor(
    public tagName: string,
    public childNodes: unknown[] = [],
    public dataset: Record<string, string> = {},
  ) {}
}

const textNode = (value: string) => ({ nodeType: 3, textContent: value });
const el = (tag: string, children: unknown[] = [], dataset: Record<string, string> = {}) =>
  new FakeElement(tag, children, dataset);
const editable = (children: unknown[]) => new FakeElement('DIV', children) as unknown as HTMLElement;

const originalNode = (globalThis as Record<string, unknown>).Node;
const originalHTMLElement = (globalThis as Record<string, unknown>).HTMLElement;

beforeAll(() => {
  (globalThis as Record<string, unknown>).Node = { TEXT_NODE: 3 };
  (globalThis as Record<string, unknown>).HTMLElement = FakeElement;
});

afterAll(() => {
  (globalThis as Record<string, unknown>).Node = originalNode;
  (globalThis as Record<string, unknown>).HTMLElement = originalHTMLElement;
});

describe('serializeEditable', () => {
  it('keeps newlines when pasted lines are wrapped in block <div>s', () => {
    // Chromium represents "{ ...\n  ...\n  ... }" pasted into an empty editable
    // as a leading text node plus one <div> per following line. The old
    // serializer dropped these block boundaries, collapsing the JSON to one line.
    const root = editable([
      textNode('{ "a": 1,'),
      el('DIV', [textNode('  "b": 2,')]),
      el('DIV', [textNode('  "c": 3 }')]),
    ]);
    expect(serializeEditable(root)).toBe('{ "a": 1,\n  "b": 2,\n  "c": 3 }');
  });

  it('treats <br> as a newline without doubling up at a block edge', () => {
    const root = editable([
      textNode('line1'),
      el('DIV', [textNode('line2'), el('BR')]),
      el('DIV', [textNode('line3')]),
    ]);
    expect(serializeEditable(root)).toBe('line1\nline2\nline3');
  });

  it('renders a blank line for an empty <div>', () => {
    const root = editable([
      textNode('a'),
      el('DIV', [el('BR')]),
      el('DIV', [textNode('b')]),
    ]);
    expect(serializeEditable(root)).toBe('a\n\nb');
  });

  it('serializes mention chips to their @[...] markers', () => {
    const root = editable([
      textNode('hi '),
      el('SPAN', [textNode('Calendar')], { mention: 'Calendar' }),
      textNode(' there'),
    ]);
    expect(serializeEditable(root)).toBe('hi @[Calendar] there');
  });

  it('leaves single-line input untouched', () => {
    const root = editable([textNode('just one line')]);
    expect(serializeEditable(root)).toBe('just one line');
  });
});
