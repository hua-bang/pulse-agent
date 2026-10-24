// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CanvasNode } from '../../../../../../types';
import { useEmptyTextCleanup } from './useEmptyTextCleanup';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const text = (id: string, content: string) => ({
  id, type: 'text', title: 'Text', x: 0, y: 0, width: 40, height: 28, data: { content },
}) as CanvasNode;

describe('useEmptyTextCleanup', () => {
  let host: HTMLDivElement;
  let root: Root;
  let removeNodes: ReturnType<typeof vi.fn>;
  const nodesRef = { current: [] as CanvasNode[] };

  const Probe = ({ selected }: { selected: string[] }) => {
    useEmptyTextCleanup({ selectedNodeIds: selected, nodesRef, removeNodes });
    return null;
  };

  const select = (selected: string[]) => act(() => root.render(<Probe selected={selected} />));

  beforeEach(() => {
    host = document.createElement('div');
    root = createRoot(host);
    removeNodes = vi.fn();
    nodesRef.current = [
      text('blank', '<p></p>'),
      text('spaces', '<p>&nbsp; </p>'),
      text('filled', '<p>hi</p>'),
      text('autolink', '<https://example.com>'),
      { ...text('note', ''), type: 'file' } as CanvasNode,
    ];
  });

  afterEach(() => act(() => root.unmount()));

  it('removes an empty text node once it leaves the selection', () => {
    select(['blank']);
    expect(removeNodes).not.toHaveBeenCalled();
    select([]);
    expect(removeNodes).toHaveBeenCalledWith(['blank']);
  });

  it('treats whitespace-only content as empty and keeps written text and other node types', () => {
    select(['spaces', 'filled', 'autolink', 'note']);
    select([]);
    expect(removeNodes).toHaveBeenCalledWith(['spaces']);
  });

  it('leaves empty text nodes that were never selected', () => {
    select(['filled']);
    select([]);
    expect(removeNodes).not.toHaveBeenCalled();
  });
});
