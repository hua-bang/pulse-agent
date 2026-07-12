import { useCallback, useEffect, useRef, useState } from 'react';
import './index.css';
import { EditorContent } from '@tiptap/react';
import type { CanvasNode, FileNodeData } from '../../types';
import { useFileNodeEditor, getMarkdown } from '../../hooks/useFileNodeEditor';
import { useFileNodeEditorRegistry } from '../../hooks/useFileNodeEditorRegistry';
import { useNoteMentions } from '../../hooks/useNoteMentions';
import { filterCmds } from '../../editor/slashCommands';
import { dispatchOpenNode, parseNodeLinkHref } from '../../utils/openNodeBridge';
import { FileNodeToolbar } from '../FileNodeToolbar';
import { FileNodeBubbleMenu } from '../FileNodeBubbleMenu';
import { SlashCommandMenu } from '../SlashCommandMenu';
import { NoteMentionMenu } from '../NoteMentionMenu';
import { NoteFindBar } from '../NoteFindBar';
import { NoteOutline } from '../NoteOutline';
import { NoteLinkPrompt } from '../NoteLinkPrompt';
import { useRightDock } from '../RightDock';
import { useI18n } from '../../i18n';
import { deleteNoteBlock, duplicateCurrentNoteBlock, moveCurrentNoteBlock } from '../../editor/noteBlockCommands';
import { NoteBlockHandle } from '../NoteBlockHandle';

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
  const statusTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const dataRef = useRef(data);
  dataRef.current = data;
  const nodeIdRef = useRef(node.id);
  nodeIdRef.current = node.id;
  const prevContentRef = useRef(data.content);
  const workspaceIdRef = useRef(workspaceId);
  workspaceIdRef.current = workspaceId;

  const showStatus = useCallback((msg: string, duration = 2000) => {
    if (statusTimerRef.current) clearTimeout(statusTimerRef.current);
    setStatusText(msg);
    statusTimerRef.current = setTimeout(() => setStatusText(''), duration);
  }, []);

  useEffect(() => () => {
    if (statusTimerRef.current) clearTimeout(statusTimerRef.current);
  }, []);

  const persistToFile = useCallback(
    async (markdown: string, filePath: string) => {
      const api = window.canvasWorkspace?.file;
      if (!api || !filePath) return;
      const res = await api.write(filePath, markdown).catch(() => ({ ok: false }));
      if (res.ok) {
        setModified(false);
        onUpdate(nodeIdRef.current, {
          data: { ...dataRef.current, content: markdown, saved: true, modified: false },
        });
        showStatus(t('noteToolbar.saved'));
      } else {
        showStatus(t('noteToolbar.saveFailed'));
      }
    },
    [onUpdate, showStatus, t]
  );

  const {
    editor,
    interactions,
    slashMenu,
    bubble,
    handleSlashSelect,
    linkPrompt,
    openLinkPrompt,
    applyLink,
    cancelLink,
    imageInputRef,
    openImagePicker,
    insertImageFromFile,
    findBarOpen,
    openFindBar,
    closeFindBar,
    outlineOpen,
    toggleOutline,
    closeOutline,
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
    onCommitState: (state) => {
      if (state === 'saving') {
        if (statusTimerRef.current) clearTimeout(statusTimerRef.current);
        setStatusText(t('noteToolbar.saving'));
      } else {
        showStatus(t(state === 'saved' ? 'noteToolbar.saved' : 'noteToolbar.saveFailed'));
      }
    },
  });

  useEffect(() => {
    if (autoFocus && editor) editor.commands.focus('end');
  }, [autoFocus, editor]);

  const mentionCandidates = getAllNodes ? getAllNodes().filter((n) => n.id !== node.id) : [];
  const { mentionMenu, filteredMentions, insertMention, closeMention } = useNoteMentions({
    editor,
    candidates: mentionCandidates,
    readOnly,
    workspaceId,
    interactions,
  });

  useEffect(() => {
    if (
      readOnly ||
      !outlineOpen ||
      slashMenu ||
      mentionMenu ||
      linkPrompt ||
      findBarOpen
    ) {
      return;
    }

    const handler = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      const target = event.target instanceof Node ? event.target : null;
      const eventBelongsToThisNote =
        (target && cardRef.current?.contains(target)) || editor?.isFocused;
      if (!eventBelongsToThisNote) return;

      event.preventDefault();
      event.stopPropagation();
      closeOutline();
    };

    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [
    editor,
    findBarOpen,
    linkPrompt,
    mentionMenu,
    outlineOpen,
    readOnly,
    slashMenu,
    closeOutline,
  ]);

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

  const handleOpenFile = useCallback(async () => {
    if (readOnly) return;
    const api = window.canvasWorkspace?.file;
    if (!api) return;
    const res = await api.openDialog();
    if (!res.ok || res.canceled) return;
    const content = res.content || '';
    prevContentRef.current = content;
    editor?.commands.setContent(content);
    setModified(false);
    onUpdate(nodeIdRef.current, {
      title: res.fileName || node.title,
      data: { filePath: res.filePath || '', content, saved: true, modified: false },
    });
    showStatus(`Opened ${res.fileName}`);
  }, [editor, node.title, onUpdate, showStatus, readOnly]);

  const handleSaveAs = useCallback(async () => {
    if (readOnly) return;
    const api = window.canvasWorkspace?.file;
    if (!api || !editor) return;
    const defaultName = dataRef.current.filePath
      ? dataRef.current.filePath.split('/').pop() || 'untitled.md'
      : (node.title || 'untitled') + '.md';
    const markdown = getMarkdown(editor);
    const res = await api.saveAsDialog(defaultName, markdown);
    if (!res.ok || res.canceled) return;
    setModified(false);
    onUpdate(nodeIdRef.current, {
      title: res.fileName || node.title,
      data: {
        ...dataRef.current,
        filePath: res.filePath || dataRef.current.filePath,
        content: markdown,
        saved: true,
        modified: false,
      },
    });
    showStatus(`Saved to ${res.fileName}`);
  }, [editor, node.title, onUpdate, showStatus, readOnly]);

  const handleManualSave = useCallback(() => {
    if (readOnly) return;
    const fp = dataRef.current.filePath;
    if (fp && editor) {
      void persistToFile(getMarkdown(editor), fp);
    } else {
      void handleSaveAs();
    }
  }, [editor, persistToFile, handleSaveAs, readOnly]);

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
      // A node mention focuses its target node instead of opening a URL.
      const nodeLink = parseNodeLinkHref(href);
      if (nodeLink) {
        e.preventDefault();
        e.stopPropagation();
        const targetWorkspaceId = nodeLink.workspaceId ?? workspaceId ?? '';
        const targetNodeKnown = !getAllNodes || getAllNodes().some((item) => item.id === nodeLink.nodeId);
        if (!targetNodeKnown && targetWorkspaceId === (workspaceId ?? '')) {
          showStatus('Missing node');
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
    [getAllNodes, openLink, showStatus, workspaceId],
  );

  const filePath = data.filePath;
  const fileName = filePath ? filePath.split('/').pop() : null;

  return (
    <div ref={cardRef} className="note-card">
      {!readOnly && (
        <FileNodeToolbar
          onOpenFile={handleOpenFile}
          onSave={handleManualSave}
          onSaveAs={handleSaveAs}
          onInsertImage={openImagePicker}
          onOpenFind={openFindBar}
          onToggleOutline={toggleOutline}
          onMoveBlockUp={() => {
            if (editor) moveCurrentNoteBlock(editor, -1);
          }}
          onMoveBlockDown={() => {
            if (editor) moveCurrentNoteBlock(editor, 1);
          }}
          onDuplicateBlock={() => {
            if (editor) duplicateCurrentNoteBlock(editor);
          }}
          onDeleteBlock={() => {
            if (editor) deleteNoteBlock(editor);
          }}
          outlineOpen={outlineOpen}
          statusText={statusText}
          modified={modified}
          fileName={fileName}
          filePath={filePath ?? undefined}
        />
      )}

      {!readOnly && findBarOpen && editor && <NoteFindBar editor={editor} onClose={closeFindBar} />}

      {!readOnly && outlineOpen && editor && (
        <NoteOutline editor={editor} onClose={closeOutline} />
      )}

      {!readOnly && linkPrompt && (
        <NoteLinkPrompt
          initial={linkPrompt.initial}
          onApply={applyLink}
          onCancel={cancelLink}
        />
      )}

      {!readOnly && bubble && editor && (
        <FileNodeBubbleMenu editor={editor} bubble={bubble} onOpenLinkPrompt={openLinkPrompt} />
      )}

      <div
        className="note-content"
        onPaste={(e) => e.stopPropagation()}
        onWheel={(e) => e.stopPropagation()}
        onClickCapture={handleLinkClickCapture}
      >
        <EditorContent editor={editor} className="note-tiptap-editor" />
      </div>

      {!readOnly && editor && (
        <NoteBlockHandle editor={editor} cardRef={cardRef} />
      )}

      <input
        ref={imageInputRef}
        type="file"
        accept="image/*"
        style={{ display: 'none' }}
        onChange={handleImageInputChange}
      />

      {!readOnly && slashMenu && (
        <SlashCommandMenu
          x={slashMenu.x}
          y={slashMenu.y}
          selectedIndex={slashMenu.index}
          items={filterCmds(slashMenu.query)}
          onSelect={handleSlashSelect}
          onClose={interactions.closeSlashMenu}
        />
      )}

      {!readOnly && mentionMenu && (
        <NoteMentionMenu
          x={mentionMenu.x}
          y={mentionMenu.y}
          items={filteredMentions}
          selectedIndex={mentionMenu.index}
          onSelect={insertMention}
          onClose={closeMention}
        />
      )}
    </div>
  );
};
