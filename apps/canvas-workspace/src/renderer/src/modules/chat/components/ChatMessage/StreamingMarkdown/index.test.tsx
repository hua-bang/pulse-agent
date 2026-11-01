// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { StreamingMarkdown } from '.';
import { renderMarkdown } from '../../utils/markdown';
import { loadHighlighter } from '../../../../../utils/syntaxHighlighter';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let host: HTMLDivElement;

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

const body = () => host.querySelector('.chat-md') as HTMLDivElement;

describe('StreamingMarkdown', () => {
  it('renders a finished block once and re-renders only the tail', () => {
    const render = vi.fn((markdown: string) => renderMarkdown(markdown, { streaming: true }));
    const show = (text: string) => act(() => root.render(<StreamingMarkdown text={text} render={render} />));

    show('First paragraph.\n\nSecond');
    show('First paragraph.\n\nSecond paragraph.\n');
    const first = body().querySelector('p');
    show('First paragraph.\n\nSecond paragraph.\n\nThird.\n');
    show('First paragraph.\n\nSecond paragraph.\n\nThird. More');

    expect(body().querySelector('p')).toBe(first);
    expect(Array.from(body().children).map(child => child.textContent)).toEqual([
      'First paragraph.',
      'Second paragraph.',
      'Third. More',
    ]);
    expect(render.mock.calls.map(([markdown]) => markdown)).toEqual([
      'First paragraph.\n\nSecond',
      'First paragraph.\n\n',
      'Second paragraph.\n',
      'Second paragraph.\n\n',
      'Third.\n',
      'Third. More',
    ]);
  });

  it('starts over when the text no longer extends the rendered text', () => {
    const render = (markdown: string) => renderMarkdown(markdown, { streaming: true });
    act(() => root.render(<StreamingMarkdown text={'Old.\n\nTail\n'} render={render} />));
    act(() => root.render(<StreamingMarkdown text={'New.\n\nTail\n'} render={render} />));

    expect(Array.from(body().children).map(child => child.textContent)).toEqual(['New.', 'Tail']);
  });

  it('appends finished lines to an open code block instead of re-rendering it', async () => {
    await loadHighlighter();
    const render = vi.fn((markdown: string) => renderMarkdown(markdown, { streaming: true }));
    const show = (text: string) => act(() => root.render(<StreamingMarkdown text={text} render={render} />));

    show('```ts\nconst a = 1;\nconst b');
    const code = body().querySelector('code');
    show('```ts\nconst a = 1;\nconst b = 2;\nlet c');

    expect(body().querySelector('code')).toBe(code);
    expect(code?.textContent).toBe('const a = 1;\nconst b = 2;\nlet c');
    expect(code?.querySelector('.hljs-keyword')).not.toBeNull();
    // Only the block shell went through the Markdown renderer.
    expect(render).toHaveBeenCalledTimes(1);
  });

  it('keeps a closed code block in place when the next block starts', async () => {
    await loadHighlighter();
    const render = vi.fn((markdown: string) => renderMarkdown(markdown, { streaming: true }));
    const show = (text: string) => act(() => root.render(<StreamingMarkdown text={text} render={render} />));

    show('```ts\nconst a = 1;\n');
    const code = body().querySelector('code');
    show('```ts\nconst a = 1;\n```\n\nAf');
    show('```ts\nconst a = 1;\n```\n\nAfter\n');

    expect(body().querySelector('code')).toBe(code);
    expect(code?.textContent).toBe('const a = 1;\n');
    expect(body().lastElementChild?.textContent).toBe('After');
    // The block shell and the paragraph; the closed block is not rendered again.
    expect(render.mock.calls.map(([markdown]) => markdown)).toEqual(['```ts\n```', 'After\n']);
  });
});

