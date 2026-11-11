import { describe, expect, it } from 'vitest';
import type { CanvasNode } from '../../types';
import { getNodeSearchText } from '../nodeSearchText';

const node = (type: CanvasNode['type'], data: unknown): CanvasNode => ({
  id: `${type}-1`,
  type,
  title: '',
  x: 0,
  y: 0,
  width: 100,
  height: 100,
  data,
} as CanvasNode);

describe('getNodeSearchText', () => {
  it('collects every mind-map topic, including nested and collapsed ones', () => {
    const text = getNodeSearchText(node('mindmap', {
      layout: 'right',
      root: {
        id: 'r',
        text: 'Root',
        children: [
          { id: 'a', text: 'Idea 1', children: [] },
          { id: 'b', text: 'Idea 2', collapsed: true, children: [{ id: 'c', text: 'Hidden leaf', children: [] }] },
        ],
      },
    })).text;
    expect(text).toContain('Idea 2');
    expect(text).toContain('Hidden leaf');
  });

  it('reads web addresses, shape text, and terminal output', () => {
    expect(getNodeSearchText(node('iframe', { url: 'https://example.com/docs', pageTitle: 'Docs' })).lower)
      .toContain('example.com/docs');
    expect(getNodeSearchText(node('shape', { kind: 'rect', text: 'Decision' })).text).toBe('Decision');
    expect(getNodeSearchText(node('terminal', { sessionId: 's', scrollback: 'npm ERR! missing script' })).text)
      .toContain('npm ERR!');
  });

  it('strips markup from note and text bodies', () => {
    expect(getNodeSearchText(node('text', { content: '<p>alpha &amp; beta</p>' })).text.trim()).toBe('alpha & beta');
    expect(getNodeSearchText(node('file', { filePath: '/a.md', content: '<p>gamma</p>' })).text).toContain('gamma');
  });

  it('caches by data object so an update re-extracts', () => {
    const data = { kind: 'rect', text: 'One' };
    const first = getNodeSearchText(node('shape', data));
    expect(getNodeSearchText(node('shape', data))).toBe(first);
    expect(getNodeSearchText(node('shape', { ...data, text: 'Two' })).text).toBe('Two');
  });
});
