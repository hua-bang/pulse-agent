import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import type { CanvasNode, TextNodeData } from '../../types';
import '../TextNodeBody/index.css';
import './index.css';

interface Props {
  node: CanvasNode;
  onUpdate: (id: string, patch: Partial<CanvasNode>) => void;
  isSelected: boolean;
  isResizing: boolean;
  onSelect: (id: string) => void;
  onDragStart: (event: React.MouseEvent, node: CanvasNode) => void;
  readOnly?: boolean;
}

const TextNodeEditor = lazy(() =>
  import('../TextNodeBody').then((module) => ({ default: module.TextNodeBody })),
);

export const htmlToPreviewText = (html: string): string => {
  if (typeof DOMParser !== 'undefined') {
    return new DOMParser().parseFromString(html, 'text/html').body.textContent ?? '';
  }
  return html.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '');
};

export const TextNodeBodyLazy = (props: Props) => {
  const data = props.node.data as TextNodeData;
  const [editorLoaded, setEditorLoaded] = useState(!props.readOnly && props.isSelected && data.content === '');
  const text = useMemo(() => htmlToPreviewText(data.content ?? ''), [data.content]);

  useEffect(() => {
    if (!props.readOnly && props.isSelected && data.content === '') {
      setEditorLoaded(true);
    }
  }, [data.content, props.isSelected, props.readOnly]);

  if (editorLoaded) {
    return (
      <Suspense fallback={<div className="text-node-preview">{text}</div>}>
        <TextNodeEditor {...props} />
      </Suspense>
    );
  }

  return (
    <div
      className="text-node-preview"
      onMouseDown={(event) => {
        if (props.readOnly) {
          event.stopPropagation();
          return;
        }
        props.onSelect(props.node.id);
        props.onDragStart(event, props.node);
      }}
      onDoubleClick={(event) => {
        event.stopPropagation();
        if (!props.readOnly) setEditorLoaded(true);
      }}
      style={{
        color: data.textColor,
        backgroundColor: data.backgroundColor,
        fontSize: data.fontSize ?? 18,
      }}
    >
      {text}
    </div>
  );
};
