// @vitest-environment happy-dom
import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../../../../../i18n';
import type { LaidOutTopic } from '../../../../../utils/mindmapLayout';
import { TopicPill } from './TopicPill';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const topic: LaidOutTopic = {
  id: 'topic-1',
  parentId: null,
  depth: 0,
  x: 0,
  y: 0,
  width: 180,
  height: 32,
  text: 'Central topic',
  color: '#5b7cbf',
  collapsed: false,
  hasChildren: true,
};

describe('TopicPill editing', () => {
  let root: Root;
  let host: HTMLElement;

  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  it('keeps the first printable character when typing starts from selection', () => {
    const Harness = () => {
      const [editing, setEditing] = useState(false);
      const [initialInput, setInitialInput] = useState<string>();
      return (
        <TopicPill
          topic={topic}
          isSelected
          isEditing={editing}
          initialInput={initialInput}
          outerCanvasSelected
          isDragSource={false}
          dropHint={null}
          onBeginReorder={vi.fn()}
          onAddChild={vi.fn()}
          onSelect={vi.fn()}
          onEnterEdit={(input) => {
            setInitialInput(input);
            setEditing(true);
          }}
          onCommitText={vi.fn()}
          onToggleCollapsed={vi.fn()}
          onKeyAction={vi.fn()}
        />
      );
    };

    act(() => root.render(<I18nProvider><Harness /></I18nProvider>));
    const pill = host.querySelector<HTMLElement>('.mindmap-topic');
    expect(pill).not.toBeNull();

    act(() => {
      pill!.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'a',
        code: 'KeyA',
        bubbles: true,
        cancelable: true,
      }));
    });

    expect(host.querySelector<HTMLElement>('.mindmap-topic-text')?.innerText)
      .toBe('Central topica');
    expect(document.activeElement).toBe(host.querySelector('.mindmap-topic-text'));
  });

  it('commits the current text before Escape returns to selection', () => {
    const onCommitText = vi.fn();
    const onKeyAction = vi.fn();
    act(() => {
      root.render(
        <I18nProvider>
          <TopicPill
            topic={topic}
            isSelected
            isEditing
            outerCanvasSelected
            isDragSource={false}
            dropHint={null}
            onBeginReorder={vi.fn()}
            onAddChild={vi.fn()}
            onSelect={vi.fn()}
            onEnterEdit={vi.fn()}
            onCommitText={onCommitText}
            onToggleCollapsed={vi.fn()}
            onKeyAction={onKeyAction}
          />
        </I18nProvider>,
      );
    });
    const editor = host.querySelector<HTMLElement>('.mindmap-topic-text');
    expect(editor).not.toBeNull();
    editor!.innerText = 'Edited topic';

    act(() => {
      editor!.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'Escape',
        code: 'Escape',
        bubbles: true,
        cancelable: true,
      }));
    });

    expect(onCommitText).toHaveBeenCalledWith('Edited topic');
    expect(onKeyAction).toHaveBeenCalledWith({ kind: 'exit' });
  });
});
