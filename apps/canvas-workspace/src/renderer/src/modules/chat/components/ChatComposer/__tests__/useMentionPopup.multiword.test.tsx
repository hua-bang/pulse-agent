// @vitest-environment happy-dom
import { act, useRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MentionItem } from '../../../../../types';
import { AT_QUERY_PATTERN, useMentionPopup } from '../useMentionPopup';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Hook = ReturnType<typeof useMentionPopup>;

const NODES: MentionItem[] = [
  { type: 'node', nodeId: 'n1', label: 'Q3 roadmap review' },
  { type: 'node', nodeId: 'n2', label: 'Notes' },
];

let root: Root | null = null;
let host: HTMLDivElement | null = null;
let latest: Hook | null = null;

const buildMentionItems = vi.fn(async (query: string) => (
  NODES.filter(item => item.label.toLowerCase().includes(query.toLowerCase()))
));
const searchSessionMentionItems = vi.fn(async () => [] as MentionItem[]);

const Probe = () => {
  const editableRef = useRef<HTMLDivElement>(null);
  latest = useMentionPopup({
    editableRef,
    setInput: () => {},
    buildMentionItems,
    searchSessionMentionItems,
  });
  return <div ref={editableRef} contentEditable />;
};

const currentEditable = (): HTMLDivElement => {
  const element = host?.querySelector<HTMLDivElement>('[contenteditable]');
  if (!element) throw new Error('editable did not mount');
  return element;
};

afterEach(() => {
  if (root) act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
  latest = null;
  buildMentionItems.mockClear();
  searchSessionMentionItems.mockClear();
});

const mount = async () => {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => root?.render(<Probe />));
};

const typeText = async (text: string) => {
  const editable = currentEditable();
  editable.textContent = text;
  const range = document.createRange();
  range.setStart(editable.firstChild as Node, text.length);
  range.collapse(true);
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
  act(() => latest?.detectMention());
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
};

describe('AT_QUERY_PATTERN', () => {
  it('accepts single spaces between words and one trailing space', () => {
    expect('hi @Q3 roadmap'.match(AT_QUERY_PATTERN)?.[1]).toBe('Q3 roadmap');
    expect('hi @Q3 '.match(AT_QUERY_PATTERN)?.[1]).toBe('Q3 ');
    expect('hi @Q3 road'.match(AT_QUERY_PATTERN)?.[1]).toBe('Q3 road');
    expect('hi @'.match(AT_QUERY_PATTERN)?.[1]).toBe('');
  });

  it('ends the query on a leading space or two consecutive spaces', () => {
    expect('hi @ Q3'.match(AT_QUERY_PATTERN)).toBeNull();
    expect('hi @Q3  roadmap'.match(AT_QUERY_PATTERN)).toBeNull();
    expect('hi @Q3  '.match(AT_QUERY_PATTERN)).toBeNull();
  });

  it('stays linear on a long failing query', () => {
    const started = performance.now();
    expect(`@${'a'.repeat(5000)}  `.match(AT_QUERY_PATTERN)).toBeNull();
    expect(performance.now() - started).toBeLessThan(200);
  });
});

describe('multi-word @-mentions', () => {
  it('keeps the popup open while a spaced query still matches a title', async () => {
    await mount();
    await typeText('see @Q3 roadmap');
    expect(latest?.mentionOpen).toBe(true);
    expect(latest?.mentionItems.map(item => item.label)).toEqual(['Q3 roadmap review']);
    expect(buildMentionItems).toHaveBeenLastCalledWith('Q3 roadmap', '@');
  });

  it('normalizes contentEditable NBSP to a plain space', async () => {
    await mount();
    await typeText('see @Q3 road');
    expect(buildMentionItems).toHaveBeenLastCalledWith('Q3 road', '@');
    expect(latest?.mentionOpen).toBe(true);
  });

  it('closes once the spaced query matches nothing', async () => {
    await mount();
    await typeText('see @Notes');
    expect(latest?.mentionOpen).toBe(true);
    await typeText('see @Notes are great');
    expect(latest?.mentionOpen).toBe(false);
  });

  it('does not reopen for prose after a closed mention query', async () => {
    await mount();
    await typeText('see @Notes are');
    expect(latest?.mentionOpen).toBe(false);
    expect(latest?.mentionLoading).toBe(false);
  });

  it('closes on two consecutive spaces even when the words matched', async () => {
    await mount();
    await typeText('see @Q3 roadmap');
    expect(latest?.mentionOpen).toBe(true);
    await typeText('see @Q3 roadmap  ');
    expect(latest?.mentionOpen).toBe(false);
  });

  it('still shows the empty state for a single-word query with no match', async () => {
    await mount();
    await typeText('see @zzz');
    expect(latest?.mentionOpen).toBe(true);
    expect(latest?.mentionItems).toEqual([]);
  });
});
