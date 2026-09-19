import { lazy, Suspense, useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { CanvasNode, TextNodeData } from '../../../../../types';
import { useI18n } from '../../../../../i18n';
import { useTextNodeSize } from '../TextNodeBody/useTextNodeSize';
import { renderTextPreview } from './textPreview';
import { DeferredEditorBoundary, useDeferredEditorInput } from '../useDeferredEditorInput';
import '../TextNodeBody/index.css';

interface Props {
  node: CanvasNode;
  onUpdate: (id: string, patch: Partial<CanvasNode>) => void;
  isSelected: boolean;
  isResizing: boolean;
  onSelect: (id: string) => void;
  onDragStart: (event: React.MouseEvent, node: CanvasNode) => void;
  readOnly?: boolean;
  editRequest?: number;
}

const TextNodeEditor = lazy(() =>
  import('../TextNodeBody').then((module) => ({ default: module.TextNodeBody })),
);

export const TextNodeBodyLazy = (props: Props) => {
  const { t } = useI18n();
  const data = props.node.data as TextNodeData;
  const readOnly = props.readOnly ?? false;
  const wrapperRef = useRef<HTMLDivElement>(null);
  const editRequestRef = useRef<number | undefined>();
  const [editorLoaded, setEditorLoaded] = useState(false);
  const pendingInput = useDeferredEditorInput({ identity: props.node.id, label: t('noteEditor.label') });
  const preview = useMemo(() => renderTextPreview(data.content ?? ''), [data.content]);
  const beginEditing = useCallback((point?: { x: number; y: number; scrollTop: number }) => {
    if (readOnly) return;
    props.onSelect(props.node.id);
    pendingInput.begin(point);
    setEditorLoaded(true);
  }, [pendingInput.begin, props.node.id, props.onSelect, readOnly]);

  useTextNodeSize({ ...props, readOnly, wrapperRef });

  useLayoutEffect(() => {
    if (!editorLoaded && !readOnly && props.isSelected && data.content === '') beginEditing();
  }, [beginEditing, props.isSelected, readOnly, data.content, editorLoaded]);

  // Keep an editor mounted after the first edit so selection changes retain drafts.
  useLayoutEffect(() => {
    if (!props.editRequest || props.editRequest === editRequestRef.current) return;
    editRequestRef.current = props.editRequest;
    if (props.isSelected && !readOnly) beginEditing();
  }, [beginEditing, props.editRequest, props.isSelected, readOnly]);

  const body = (
    <div
      ref={wrapperRef}
      className="text-node-body"
      onMouseDown={(event) => {
        if (readOnly) {
          event.stopPropagation();
          return;
        }
        props.onSelect(props.node.id);
        props.onDragStart(event, props.node);
      }}
      onDoubleClick={(event) => {
        event.stopPropagation();
        beginEditing({ x: event.clientX, y: event.clientY, scrollTop: 0 });
      }}

      style={{
        color: data.textColor,
        backgroundColor: data.backgroundColor,
        fontSize: data.fontSize ?? 18,
      }}
    >
      <div>
        <div className="ProseMirror">
          {data.content ? preview : (
            <p className="is-editor-empty" data-placeholder={t('canvas.textPlaceholder')}>
              <br />
            </p>
          )}
        </div>
      </div>
    </div>
  );

  return <div className="deferred-editor-surface">
    {editorLoaded ? (
      <DeferredEditorBoundary fallback={body}>
        <Suspense fallback={body}>
          <TextNodeEditor {...props} startEditing onEditorReady={pendingInput.ready} />
        </Suspense>
      </DeferredEditorBoundary>
    ) : body}
    {pendingInput.input}
  </div>;
};
