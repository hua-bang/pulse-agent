import { lazy, Suspense, useCallback, useEffect, useState } from 'react';
import type { CanvasNode, FileNodeData } from '../../../../../types';
import { dispatchOpenNode, parseNodeLinkHref } from '../../../../../utils/openNodeBridge';
import { useRightDock } from '../../../../../shared/dockPort';
import { useFileNodeEditorRegistry } from '../../../../../shared/fileNodeEditorRegistry';
import { useI18n } from '../../../../../i18n';
import { matchShortcut } from '../../../../../shortcuts/registry';
import { isImeComposing } from '../../../../../utils/ime';
import { PassiveFilePreview } from './PassiveFilePreview';
import { DeferredEditorBoundary, useDeferredEditorInput } from '../useDeferredEditorInput';
import '../FileNodeBody/index.css';
import './index.css';

interface Props {
  node: CanvasNode;
  onUpdate: (id: string, patch: Partial<CanvasNode>) => void | Promise<void>;
  workspaceId?: string;
  getAllNodes?: () => CanvasNode[];
  readOnly?: boolean;
  renderFullEditor?: boolean;
}

const FileNodeEditor = lazy(() =>
  import('../FileNodeBody').then((module) => ({ default: module.FileNodeBody })),
);

/** Keep recovery and interactive document blocks on their established renderer. */
export function requiresFileEditor(data: FileNodeData, readOnly: boolean): boolean {
  const content = data.content ?? '';
  return (!readOnly && !data.filePath) || !!data.modified
    || (!!(data.fileWriteIntentId || data.fileWriteStatus) && data.fileWriteStatus !== 'applied')
    || /<\/?[a-z][^>]*>/i.test(content)
    || /^\s*(?:[-+*]|\d+\.)\s+\[[ xX]\]/m.test(content)
    || /!\[|pulse-canvas:\/\/node\//.test(content)
    || /^\s*(?:```|~~~)\s*(?:mermaid|math)\b/im.test(content);
}

interface FreshContent {
  nodeId: string;
  filePath: string;
  source: string;
  content: string;
}

export const FileNodeBodyLazy = (props: Props) => {
  const { t } = useI18n();
  const { openLink } = useRightDock();
  const registry = useFileNodeEditorRegistry();
  const data = props.node.data as FileNodeData;
  const readOnly = props.readOnly ?? false;
  const required = !!props.renderFullEditor || requiresFileEditor(data, readOnly);
  const [editorLoaded, setEditorLoaded] = useState(required);
  const pendingInput = useDeferredEditorInput({ identity: `${props.node.id}\0${data.filePath}`, label: t('noteEditor.label') });
  const [fresh, setFresh] = useState<FreshContent | null>(null);
  const activateWithoutFocus = useCallback(() => { setEditorLoaded(true); }, []);

  useEffect(() => { if (required) setEditorLoaded(true); }, [required]);
  useEffect(() => registry?.registerActivator(props.node.id, activateWithoutFocus),
    [activateWithoutFocus, props.node.id, registry]);

  const activateEditor = useCallback((point?: { x: number; y: number; scrollTop: number }) => {
    if (readOnly) return;
    pendingInput.begin(point);
    setEditorLoaded(true);
  }, [pendingInput.begin, readOnly]);
  const handlePreviewClick = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement;
    // The shared Markdown renderer owns code-copy controls; using one is not
    // an edit gesture and must not remove the button under the pointer.
    if (target.closest('[data-action]')) return;
    const href = target.closest('a')?.getAttribute('href')?.trim();
    if (!href) {
      const viewport = event.currentTarget.querySelector('.note-tiptap-editor');
      activateEditor({ x: event.clientX, y: event.clientY, scrollTop: viewport?.scrollTop ?? 0 });
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    const nodeLink = parseNodeLinkHref(href);
    if (nodeLink) {
      dispatchOpenNode({ workspaceId: nodeLink.workspaceId ?? props.workspaceId ?? '', nodeId: nodeLink.nodeId });
    } else if (/^https?:\/\//i.test(href)) {
      openLink(href);
    }
  }, [activateEditor, openLink, props.workspaceId]);

  const onContent = useCallback((content: string) => {
    setFresh({ nodeId: props.node.id, filePath: data.filePath, source: data.content ?? '', content });
  }, [data.content, data.filePath, props.node.id]);
  const node = fresh?.nodeId === props.node.id && fresh.filePath === data.filePath && fresh.source === data.content
    ? { ...props.node, data: { ...data, content: fresh.content } } as CanvasNode : props.node;
  const preview = (
    <div
      className={`note-card file-preview${readOnly ? '' : ' file-preview--editable'}`}
      onClick={handlePreviewClick}
      onKeyDown={(event) => {
        if (!isImeComposing(event) && matchShortcut(event, 'canvas')?.id === 'canvas.renameSelection') {
          event.preventDefault();
          activateEditor();
        }
      }}
      tabIndex={readOnly ? undefined : 0}
      aria-label={readOnly ? undefined : t('noteEditor.label')}
    >
      <div className="note-tiptap-editor">
        <div className="ProseMirror">
          <PassiveFilePreview
            node={props.node}
            readOnly={readOnly}
            onUpdate={props.onUpdate}
            onContent={onContent}
            onError={activateWithoutFocus}
          />
        </div>
      </div>
    </div>
  );

  return <div className="deferred-editor-surface">
    {editorLoaded ? (
      <DeferredEditorBoundary fallback={preview}>
        <Suspense fallback={preview}>
          <FileNodeEditor {...props} node={node} onEditorReady={pendingInput.ready} />
        </Suspense>
      </DeferredEditorBoundary>
    ) : preview}
    {pendingInput.input}
  </div>;
};
