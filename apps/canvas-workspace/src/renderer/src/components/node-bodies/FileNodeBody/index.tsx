import { useCallback, useEffect, useRef, useState } from 'react';
import './index.css';
import type { CanvasNode, FileNodeData } from '../../../types';
import { useFileNodeEditor, getMarkdown } from '../../../hooks/useFileNodeEditor';
import { useFileNodeEditorRegistry } from '../../../hooks/useFileNodeEditorRegistry';
import { useNoteMentions } from '../../../hooks/useNoteMentions';
import { useNoteOutlineEscape } from '../../../hooks/useNoteOutlineEscape';
import { dispatchOpenNode, parseNodeLinkHref } from '../../../utils/openNodeBridge';
import { FileNodeEditorSurface } from '../../note-editor/FileNodeEditorSurface';
import { SpinnerIcon } from '../../icons';
import { useRightDock } from '../../dock/RightDock';
import { Button } from '../../ui';
import { useI18n } from '../../../i18n';

interface Props {
  node: CanvasNode;
  onUpdate: (id: string, patch: Partial<CanvasNode>) => void | Promise<void>;
  workspaceId?: string;
  /** Snapshot accessor for the workspace's nodes, used to populate @-mentions. */
  getAllNodes?: () => CanvasNode[];
  readOnly?: boolean;
  autoFocus?: boolean;
}

export const FileNodeBody = ({ node, onUpdate, workspaceId, getAllNodes, readOnly = false, autoFocus = false }: Props) => {
  const data = node.data as FileNodeData;
  const { t } = useI18n();
  const { openLink } = useRightDock();
  const [modified, setModified] = useState(false);
  const [statusText, setStatusText] = useState('');
  const [statusTone, setStatusTone] = useState<'saving' | 'saved' | 'error'>('saved');
  const statusTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveRevisionRef = useRef(0);
  const writeQueueRef = useRef<Promise<void>>(Promise.resolve());
  const cardRef = useRef<HTMLDivElement>(null);
  const dataRef = useRef(data);
  dataRef.current = data;
  const nodeIdRef = useRef(node.id);
  nodeIdRef.current = node.id;
  const prevContentRef = useRef(data.content);
  const workspaceIdRef = useRef(workspaceId);
  workspaceIdRef.current = workspaceId;

  const showStatus = useCallback((
    msg: string,
    tone: 'saving' | 'saved' | 'error' = 'saved',
    duration: number | null = 2000,
  ) => {
    if (statusTimerRef.current) clearTimeout(statusTimerRef.current);
    setStatusTone(tone);
    setStatusText(msg);
    statusTimerRef.current = duration === null
      ? null
      : setTimeout(() => setStatusText(''), duration);
  }, []);

  const invalidatePendingSave = useCallback(() => {
    saveRevisionRef.current += 1;
  }, []);

  useEffect(() => () => {
    if (statusTimerRef.current) clearTimeout(statusTimerRef.current);
  }, []);

  const persistToFile = useCallback(
    async (markdown: string, filePath: string) => {
      const revision = ++saveRevisionRef.current;
      const api = window.canvasWorkspace?.file;
      if (!api || !filePath) {
        if (revision === saveRevisionRef.current) {
          showStatus(t('noteToolbar.saveFailed'), 'error', null);
        }
        return;
      }
      const write = writeQueueRef.current
        .catch(() => undefined)
        .then(async () => {
          const res = await api.write(filePath, markdown).catch(() => ({ ok: false }));
          // A newer save is already queued. Let it own both the final file
          // contents and the visible status instead of briefly reporting this
          // stale revision as Saved/Error.
          if (revision !== saveRevisionRef.current) return;
          if (res.ok) {
            try {
              await onUpdate(nodeIdRef.current, {
                data: { ...dataRef.current, content: markdown, saved: true, modified: false },
              });
              setModified(false);
              showStatus(t('noteToolbar.saved'), 'saved');
            } catch {
              showStatus(t('noteToolbar.saveFailed'), 'error', null);
            }
          } else {
            showStatus(t('noteToolbar.saveFailed'), 'error', null);
          }
        });
      writeQueueRef.current = write;
      await write;
    },
    [onUpdate, showStatus, t]
  );

  const {
    editor,
    interactions,
    handleSlashSelect,
    openLinkPrompt,
    applyLink,
    cancelLink,
    imageInputRef,
    insertImageFromFile,
  } = useFileNodeEditor({
    data,
    nodeIdRef,
    dataRef,
    workspaceIdRef,
    prevContentRef,
    setModified,
    persistToFile,
    onUpdate,
    readOnly,
    onContentChange: invalidatePendingSave,
    onCommitState: (state) => {
      if (state === 'saving') {
        if (statusTimerRef.current) clearTimeout(statusTimerRef.current);
        setStatusTone('saving');
        setStatusText(t('noteToolbar.saving'));
      } else {
        const failed = state === 'error';
        showStatus(
          t(failed ? 'noteToolbar.saveFailed' : 'noteToolbar.saved'),
          failed ? 'error' : 'saved',
          failed ? null : 2000,
        );
      }
    },
  });

  const retrySave = useCallback(async () => {
    if (!editor) return;
    const markdown = getMarkdown(editor);
    const filePath = dataRef.current.filePath;
    if (statusTimerRef.current) clearTimeout(statusTimerRef.current);
    statusTimerRef.current = null;
    setStatusTone('saving');
    setStatusText(t('noteToolbar.saving'));
    if (filePath) {
      await persistToFile(markdown, filePath);
      return;
    }
    try {
      await onUpdate(nodeIdRef.current, {
        data: { ...dataRef.current, content: markdown, modified: false },
      });
      setModified(false);
      showStatus(t('noteToolbar.saved'), 'saved');
    } catch {
      showStatus(t('noteToolbar.saveFailed'), 'error', null);
    }
  }, [editor, onUpdate, persistToFile, showStatus, t]);

  useEffect(() => {
    if (autoFocus && editor) editor.commands.focus('end');
  }, [autoFocus, editor]);

  const mentionCandidates = getAllNodes ? getAllNodes().filter((n) => n.id !== node.id) : [];
  const { filteredMentions, insertMention, closeMention } = useNoteMentions({
    editor,
    candidates: mentionCandidates,
    readOnly,
    workspaceId,
    interactions,
  });

  useNoteOutlineEscape({
    editor,
    cardRef,
    readOnly,
    interactions,
  });

  // Publish this node's editor to the canvas-level registry so the
  // Ctrl/Cmd+F find bar can push its query into our NoteSearchExtension
  // and reuse the inline match highlights (no separate decoration
  // system for canvas-vs-note find). Re-registers if the editor
  // identity changes (Tiptap may rebuild on extension changes).
  const registry = useFileNodeEditorRegistry();
  useEffect(() => {
    if (!registry || !editor) return;
    const id = node.id;
    registry.register(id, editor);
    return () => registry.unregister(id);
  }, [registry, editor, node.id]);

  const handleImageInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      if (readOnly) return;
      const file = e.target.files?.[0];
      if (file) void insertImageFromFile(file);
      e.target.value = '';
    },
    [insertImageFromFile, readOnly],
  );

  // Clicking a link inside the note opens it in the right-dock preview
  // drawer — the same surface webview/iframe link clicks use. The Tiptap Link
  // extension is configured with `openOnClick: false`, so without this a click
  // just places the caret (in edit mode) or escapes to the system browser
  // (read-only); neither previews the page. Capture phase intercepts before
  // ProseMirror's own click handling.
  const handleLinkClickCapture = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const anchor = (e.target as HTMLElement).closest?.('a');
      const href = anchor?.getAttribute('href')?.trim();
      if (!href) return;
      // A node mention opens its target in a right-dock node tab.
      const nodeLink = parseNodeLinkHref(href);
      if (nodeLink) {
        e.preventDefault();
        e.stopPropagation();
        const targetWorkspaceId = nodeLink.workspaceId ?? workspaceId ?? '';
        const targetNodeKnown = !getAllNodes || getAllNodes().some((item) => item.id === nodeLink.nodeId);
        if (!targetNodeKnown && targetWorkspaceId === (workspaceId ?? '')) {
          showStatus(t('noteToolbar.missingNode'), 'error');
          return;
        }
        dispatchOpenNode({ workspaceId: targetWorkspaceId, nodeId: nodeLink.nodeId });
        return;
      }
      if (!/^https?:\/\//i.test(href)) return;
      e.preventDefault();
      e.stopPropagation();
      openLink(href);
    },
    [getAllNodes, openLink, showStatus, t, workspaceId],
  );

  return (
    <div
      ref={cardRef}
      className="note-card"
      data-modified={modified ? 'true' : 'false'}
    >
      {statusText && (
        <div
          className={`note-save-status note-save-status--${statusTone}`}
          role={statusTone === 'error' ? 'alert' : 'status'}
          aria-live={statusTone === 'error' ? 'assertive' : 'polite'}
          onMouseDown={(event) => event.stopPropagation()}
        >
          {statusTone === 'saving' && (
            <span aria-hidden="true">
              <SpinnerIcon size={12} className="note-save-status__spinner" />
            </span>
          )}
          <span>{statusText}</span>
          {statusTone === 'error' && (
            <Button
              size="xs"
              className="note-save-status__retry"
              onClick={() => void retrySave()}
            >
              {t('noteToolbar.retry')}
            </Button>
          )}
        </div>
      )}
      <FileNodeEditorSurface
        editor={editor}
        readOnly={readOnly}
        cardRef={cardRef}
        interactions={interactions}
        handleSlashSelect={handleSlashSelect}
        openLinkPrompt={openLinkPrompt}
        applyLink={applyLink}
        cancelLink={cancelLink}
        imageInputRef={imageInputRef}
        onImageInputChange={handleImageInputChange}
        onLinkClickCapture={handleLinkClickCapture}
        filteredMentions={filteredMentions}
        insertMention={insertMention}
        closeMention={closeMention}
      />
    </div>
  );
};
