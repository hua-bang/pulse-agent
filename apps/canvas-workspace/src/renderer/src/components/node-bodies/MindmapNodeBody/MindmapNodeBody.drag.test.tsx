// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../../../i18n';
import type { CanvasNode, MindmapNodeData, MindmapTopic } from '../../../types';
import { MindmapNodeBody } from '.';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const topic = (
  id: string,
  text: string,
  children: MindmapTopic[] = [],
): MindmapTopic => ({ id, text, children });

const mindmap = (id: string, root: MindmapTopic): CanvasNode => ({
  id,
  type: 'mindmap',
  title: root.text,
  x: 0,
  y: 0,
  width: 360,
  height: 200,
  data: { root, layout: 'right', rev: 0 } satisfies MindmapNodeData,
});

const source = mindmap(
  'source-map',
  topic('source-root', 'Source', [topic('source-branch', 'Branch')]),
);
const target = mindmap('target-map', topic('target-root', 'Target'));

describe('MindmapNodeBody drag gestures', () => {
  let root: Root;
  let host: HTMLElement;
  let originalElementsFromPoint: typeof document.elementsFromPoint;

  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    originalElementsFromPoint = document.elementsFromPoint;
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    Object.defineProperty(document, 'elementsFromPoint', {
      configurable: true,
      value: originalElementsFromPoint,
    });
  });

  const renderMaps = (
    onMergeTopic = vi.fn(() => true),
    onSplitTopic = vi.fn(() => true),
    options: {
      targetReadOnly?: boolean;
      separateTargetSurface?: boolean;
      targetHasMergeHandler?: boolean;
    } = {},
  ) => {
    const targetBody = (
      <MindmapNodeBody
        node={target}
        isSelected
        onUpdate={vi.fn()}
        onSelectNode={vi.fn()}
        onAutoResize={vi.fn()}
        onMergeTopic={options.targetHasMergeHandler === false ? undefined : onMergeTopic}
        onSplitTopic={onSplitTopic}
        readOnly={options.targetReadOnly}
      />
    );
    act(() => {
      root.render(
        <I18nProvider>
          <div className="canvas-transform">
            <MindmapNodeBody
              node={source}
              isSelected
              onUpdate={vi.fn()}
              onSelectNode={vi.fn()}
              onAutoResize={vi.fn()}
              onMergeTopic={onMergeTopic}
              onSplitTopic={onSplitTopic}
            />
            {options.separateTargetSurface ? null : targetBody}
          </div>
          {options.separateTargetSurface
            ? <div className="canvas-transform">{targetBody}</div>
            : null}
        </I18nProvider>,
      );
    });
    return { onMergeTopic, onSplitTopic };
  };

  it('merges a whole mindmap when its root is dragged onto another root', () => {
    const { onMergeTopic } = renderMaps();
    const sourceRoot = host.querySelector<HTMLElement>(
      '[data-mindmap-node-id="source-map"] [data-topic-id="source-root"]',
    )!;
    const targetRoot = host.querySelector<HTMLElement>(
      '[data-mindmap-node-id="target-map"] [data-topic-id="target-root"]',
    )!;
    vi.spyOn(targetRoot, 'getBoundingClientRect').mockReturnValue({
      x: 300,
      y: 100,
      left: 300,
      top: 100,
      right: 420,
      bottom: 140,
      width: 120,
      height: 40,
      toJSON: () => undefined,
    });
    Object.defineProperty(document, 'elementsFromPoint', {
      configurable: true,
      value: vi.fn(() => [targetRoot]),
    });

    act(() => {
      sourceRoot.dispatchEvent(new MouseEvent('mousedown', {
        bubbles: true,
        button: 0,
        clientX: 20,
        clientY: 20,
      }));
      window.dispatchEvent(new MouseEvent('mousemove', {
        clientX: 340,
        clientY: 120,
      }));
      window.dispatchEvent(new MouseEvent('mouseup', {
        clientX: 340,
        clientY: 120,
      }));
    });

    expect(onMergeTopic).toHaveBeenCalledWith({
      sourceNodeId: 'source-map',
      sourceTopicId: 'source-root',
      targetNodeId: 'target-map',
      target: { kind: 'child', parentId: 'target-root' },
    });
  });

  it('preserves the first printable character through the full mindmap body', () => {
    renderMaps();
    const sourceRoot = host.querySelector<HTMLElement>(
      '[data-mindmap-node-id="source-map"] [data-topic-id="source-root"]',
    )!;

    act(() => {
      sourceRoot.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'Z',
        code: 'KeyZ',
        bubbles: true,
        cancelable: true,
      }));
    });

    expect(
      sourceRoot.querySelector<HTMLElement>('.mindmap-topic-text')?.innerText,
    ).toBe('SourceZ');
  });

  it.each([
    { label: 'read-only', targetReadOnly: true, separateTargetSurface: false },
    { label: 'another canvas surface', targetReadOnly: false, separateTargetSurface: true },
    {
      label: 'editable preview without a canvas merge handler',
      targetReadOnly: false,
      separateTargetSurface: false,
      targetHasMergeHandler: false,
    },
  ])('rejects a $label mindmap as a merge target', ({
    targetReadOnly,
    separateTargetSurface,
    targetHasMergeHandler,
  }) => {
    const onMergeTopic = vi.fn(() => true);
    renderMaps(onMergeTopic, vi.fn(() => true), {
      targetReadOnly,
      separateTargetSurface,
      targetHasMergeHandler,
    });
    const sourceRoot = host.querySelector<HTMLElement>(
      '[data-mindmap-node-id="source-map"] [data-topic-id="source-root"]',
    )!;
    const targetRoot = host.querySelector<HTMLElement>(
      '[data-mindmap-node-id="target-map"] [data-topic-id="target-root"]',
    )!;
    vi.spyOn(targetRoot, 'getBoundingClientRect').mockReturnValue({
      x: 300,
      y: 100,
      left: 300,
      top: 100,
      right: 420,
      bottom: 140,
      width: 120,
      height: 40,
      toJSON: () => undefined,
    });
    Object.defineProperty(document, 'elementsFromPoint', {
      configurable: true,
      value: vi.fn(() => [targetRoot]),
    });

    act(() => {
      sourceRoot.dispatchEvent(new MouseEvent('mousedown', {
        bubbles: true,
        button: 0,
        clientX: 20,
        clientY: 20,
      }));
      window.dispatchEvent(new MouseEvent('mousemove', {
        clientX: 340,
        clientY: 120,
      }));
      window.dispatchEvent(new MouseEvent('mouseup', {
        clientX: 340,
        clientY: 120,
      }));
    });

    expect(onMergeTopic).not.toHaveBeenCalled();
  });

  it('splits a branch when it is dropped outside its mindmap', () => {
    const { onSplitTopic } = renderMaps();
    const sourceBody = host.querySelector<HTMLElement>(
      '[data-mindmap-node-id="source-map"]',
    )!;
    const branch = sourceBody.querySelector<HTMLElement>(
      '[data-topic-id="source-branch"]',
    )!;
    vi.spyOn(sourceBody, 'getBoundingClientRect').mockReturnValue({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 200,
      bottom: 160,
      width: 200,
      height: 160,
      toJSON: () => undefined,
    });
    Object.defineProperty(document, 'elementsFromPoint', {
      configurable: true,
      value: vi.fn(() => []),
    });

    act(() => {
      branch.dispatchEvent(new MouseEvent('mousedown', {
        bubbles: true,
        button: 0,
        clientX: 60,
        clientY: 60,
      }));
      window.dispatchEvent(new MouseEvent('mousemove', {
        clientX: 480,
        clientY: 320,
      }));
      window.dispatchEvent(new MouseEvent('mouseup', {
        clientX: 480,
        clientY: 320,
      }));
    });

    expect(onSplitTopic).toHaveBeenCalledWith(
      'source-map',
      'source-branch',
      480,
      320,
    );
  });
});
