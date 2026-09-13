// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it } from 'vitest';
import { I18nProvider } from '../../../../i18n';
import { LibraryMindmapPreview } from './LibraryMindmapPreview';
import { buildLibraryItems, filterLibraryItems } from './libraryModel';
import type { CanvasNode, MindmapTopic } from '../../../../types';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const tree: MindmapTopic = { id: 'root', text: 'Research', children: [{ id: 'child', text: 'Evidence', children: [] }] };
it('classifies mindmaps separately and retains their live tree for thumbnails', () => {
  const node: CanvasNode = { id: 'map', type: 'mindmap', title: 'Research', x: 0, y: 0, width: 300, height: 200, data: { root: tree, layout: 'right' } };
  const items = buildLibraryItems([], [node], [], [], 'ws');
  expect(filterLibraryItems(items, 'ws', 'mindmap', '')).toHaveLength(1);
  expect(filterLibraryItems(items, 'ws', 'other', '')).toHaveLength(0);
  expect(items[0].mindmapRoot).toBe(tree);
});
it('renders topics and branches in a centered, non-editable SVG', () => {
  const host = document.createElement('div'); document.body.append(host);
  const root = createRoot(host);
  try {
    act(() => root.render(<I18nProvider><LibraryMindmapPreview root={tree} detail /></I18nProvider>));
    expect(host.querySelector('svg')?.getAttribute('preserveAspectRatio')).toBe('xMidYMid meet');
    expect(host.querySelectorAll('path')).toHaveLength(1);
    expect(host.textContent).toContain('Evidence');
    expect(host.querySelector('[contenteditable]')).toBeNull();
  } finally { act(() => root.unmount()); host.remove(); }
});
