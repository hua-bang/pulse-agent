import { useCallback, useEffect, useRef } from 'react';
import { useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Image from '@tiptap/extension-image';
import Paragraph from '@tiptap/extension-paragraph';
import Placeholder from '@tiptap/extension-placeholder';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import Link from '@tiptap/extension-link';
import Underline from '@tiptap/extension-underline';
import Highlight from '@tiptap/extension-highlight';
import { Table } from '@tiptap/extension-table';
import TableRow from '@tiptap/extension-table-row';
import TableCell from '@tiptap/extension-table-cell';
import TableHeader from '@tiptap/extension-table-header';
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight';
import { common, createLowlight } from 'lowlight';
import { Markdown } from 'tiptap-markdown';
import type { CanvasNode, FileNodeData } from '../types';
import type { SlashCommandDef } from '../components/SlashCommandMenu';
import { ALL_SLASH_COMMANDS, filterCmds, type SlashCmdContext } from '../editor/slashCommands';
import { NoteSearchExtension } from '../editor/noteSearchExtension';
import { Callout } from '../editor/calloutNode';
import { toFileUrl } from '../utils/fileUrl';
import { isImeComposing } from '../utils/ime';
import { useNoteKeyboard } from './useNoteKeyboard';
import { useNoteInteractionController } from './useNoteInteractionController';
import {
  insertImageAtPos,
  insertImageAtSelection,
  isImageUrl,
  resolveWorkspaceId,
  saveImageBlob,
} from '../utils/noteImageInsert';

const lowlight = createLowlight(common);

// Markdown collapses consecutive blank lines into a single paragraph
// separator, so empty paragraphs typed by the user (Enter → Enter) are
// lost after save+reload. Preserve them by emitting a non-breaking space
// during markdown serialization — that keeps one paragraph per blank line
// through the markdown roundtrip, matching the pre-reload editor view.
const EMPTY_PARAGRAPH_MARKER = '\u00A0';

const EmptyLinePreservingParagraph = Paragraph.extend({
  addStorage() {
    return {
      ...this.parent?.(),
      markdown: {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        serialize(state: any, node: any) {
          if (node.childCount === 0) {
            state.write(EMPTY_PARAGRAPH_MARKER);
          } else {
            state.renderInline(node);
          }
          state.closeBlock(node);
        },
        parse: {},
      },
    };
  },
});

const FILE_IMAGE_MARKDOWN_RE = /!\[([^\]]*)\]\(((?:file:\/\/|pulse-canvas:\/\/)[^\s)]+)(?:\s+"([^"]*)")?\)/g;
const LOCAL_IMAGE_HINT_RE = /\]\((?:file:\/\/|pulse-canvas:\/\/)/;

const restoreLocalImageMarkdown = (element: HTMLElement) => {
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  const textNodes: Text[] = [];
  while (walker.nextNode()) {
    const node = walker.currentNode;
    if (node.textContent?.includes('![') && LOCAL_IMAGE_HINT_RE.test(node.textContent)) {
      textNodes.push(node as Text);
    }
  }

  for (const node of textNodes) {
    const text = node.textContent ?? '';
    FILE_IMAGE_MARKDOWN_RE.lastIndex = 0;
    if (!FILE_IMAGE_MARKDOWN_RE.test(text)) continue;

    FILE_IMAGE_MARKDOWN_RE.lastIndex = 0;
    const fragment = document.createDocumentFragment();
    let lastIndex = 0;
    for (const match of text.matchAll(FILE_IMAGE_MARKDOWN_RE)) {
      const index = match.index ?? 0;
      if (index > lastIndex) {
        fragment.append(document.createTextNode(text.slice(lastIndex, index)));
      }

      const img = document.createElement('img');
      // Legacy notes may contain `file://…` URLs that Chromium refuses to
      // load; route everything through the custom scheme.
      img.setAttribute('src', toFileUrl(match[2] ?? ''));
      img.setAttribute('alt', match[1] ?? '');
      if (match[3]) img.setAttribute('title', match[3]);
      fragment.append(img);
      lastIndex = index + match[0].length;
    }
    if (lastIndex < text.length) {
      fragment.append(document.createTextNode(text.slice(lastIndex)));
    }
    node.replaceWith(fragment);
  }
};

const MarkdownSafeImage = Image.extend({
  addStorage() {
    return {
      ...this.parent?.(),
      markdown: {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        serialize(state: any, node: any) {
          const src = String(node.attrs.src ?? '').replace(/[()]/g, '\\$&');
          const alt = state.esc(String(node.attrs.alt ?? ''));
          const title = node.attrs.title
            ? ` "${String(node.attrs.title).replace(/"/g, '\\"')}"`
            : '';
          state.write(`![${alt}](${src}${title})`);
        },
        parse: {
          // markdown-it rejects file:// and custom-scheme links by default,
          // so reloading a note with a locally saved pasted image leaves
          // literal ![](...) text. File nodes intentionally store local
          // canvas images as file URLs (`pulse-canvas://` for new content,
          // legacy `file://` for notes created before the protocol switch).
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          setup(markdownit: any) {
            const originalValidateLink = markdownit.validateLink.bind(markdownit);
            markdownit.validateLink = (url: string) => {
              if (/^(file|pulse-canvas):\/\//i.test(url)) return true;
              return originalValidateLink(url);
            };
          },
          updateDOM(element: HTMLElement) {
            restoreLocalImageMarkdown(element);
          },
        },
      },
    };
  },
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const getMarkdown = (editor: any): string =>
  (editor?.storage?.markdown?.getMarkdown() as string | undefined) ?? '';

interface Options {
  data: FileNodeData;
  nodeIdRef: React.MutableRefObject<string>;
  dataRef: React.MutableRefObject<FileNodeData>;
  workspaceIdRef: React.MutableRefObject<string | undefined>;
  prevContentRef: React.MutableRefObject<string>;
  setModified: (val: boolean) => void;
  persistToFile: (markdown: string, filePath: string) => Promise<void>;
  onUpdate: (id: string, patch: Partial<CanvasNode>) => void;
  readOnly?: boolean;
}

const AUTO_SAVE_MS = 1500;
// Debounce the per-keystroke serialize + nodes-array writeback (I-1).
const CONTENT_COMMIT_MS = 200;

export const useFileNodeEditor = ({
  data,
  nodeIdRef,
  dataRef,
  workspaceIdRef,
  prevContentRef,
  setModified,
  persistToFile,
  onUpdate,
  readOnly = false,
}: Options) => {
  const interactions = useNoteInteractionController();
  const {
    slashMenu,
    slashMenuRef,
    openSlashMenu,
    closeSlashMenu,
    moveSlashSelection,
    bubble,
    openBubble,
    closeBubble,
    linkPrompt,
    openLinkPrompt: openControlledLinkPrompt,
    closeLinkPrompt,
    findBarOpen,
    openFindBar,
    closeFindBar,
    outlineOpen,
    toggleOutline,
    closeOutline,
    resetForReadOnly,
  } = interactions;
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const imageInputRef = useRef<HTMLInputElement | null>(null);
  const contentCommitRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingEditorRef = useRef<any>(null);

  // Serialize the doc and push it into the central nodes array. Debounced from
  // onUpdate; `flushPersist` writes the file now (blur/unmount) vs auto-save.
  const commitContent = useCallback((flushPersist = false) => {
    if (contentCommitRef.current) {
      clearTimeout(contentCommitRef.current);
      contentCommitRef.current = null;
    }
    const editor = pendingEditorRef.current;
    if (!editor) return;
    const markdown = getMarkdown(editor);
    const previous = dataRef.current.content ?? '';
    if (!editor.isFocused && markdown.trim().length === 0 && previous.trim().length > 0) {
      console.warn(`[file-node-editor] skipped empty initialization update for ${nodeIdRef.current}`);
      return;
    }
    prevContentRef.current = markdown;
    setModified(true);
    onUpdate(nodeIdRef.current, {
      data: { ...dataRef.current, content: markdown, modified: true },
    });
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    const fp = dataRef.current.filePath;
    if (!fp) return;
    if (flushPersist) {
      void persistToFile(markdown, fp);
    } else {
      saveTimerRef.current = setTimeout(() => void persistToFile(markdown, fp), AUTO_SAVE_MS);
    }
  }, [dataRef, nodeIdRef, prevContentRef, setModified, onUpdate, persistToFile]);

  const editor = useEditor({
    extensions: [
      // StarterKit v3 bundles Link + Underline + CodeBlock — disable the
      // built-ins since we register explicit configured versions below.
      // Also disable Paragraph so our empty-line-preserving version wins.
      StarterKit.configure({
        codeBlock: false,
        link: false,
        underline: false,
        paragraph: false,
      }),
      EmptyLinePreservingParagraph,
      MarkdownSafeImage.configure({ inline: false }),
      Callout,
      Placeholder.configure({ placeholder: "Type '/' for blocks, or just start writing…" }),
      TaskList,
      TaskItem.configure({ nested: true }),
      Underline,
      Highlight.configure({ multicolor: false }),
      Link.configure({
        openOnClick: false,
        autolink: true,
        linkOnPaste: true,
        // Allow the internal node-mention scheme so `@` links aren't stripped.
        protocols: ['pulse-canvas'],
        HTMLAttributes: { rel: 'noopener noreferrer', target: '_blank' },
      }),
      CodeBlockLowlight.configure({ lowlight, defaultLanguage: null }),
      Table.configure({ resizable: false, HTMLAttributes: { class: 'note-table' } }),
      TableRow,
      TableHeader,
      TableCell,
      NoteSearchExtension,
      Markdown.configure({ html: false, transformPastedText: true }),
    ],
    content: data.content || '',
    editable: !readOnly,
    editorProps: {
      handlePaste: (view, event) => {
        if (readOnly) return false;
        const items = Array.from(event.clipboardData?.items ?? []);
        const imageItem = items.find((i) => i.type.startsWith('image/'));
        if (imageItem) {
          const blob = imageItem.getAsFile();
          if (!blob) return false;
          event.preventDefault();
          const wsId = resolveWorkspaceId(workspaceIdRef.current, dataRef.current.filePath);
          void saveImageBlob(blob, wsId).then((src) => {
            if (src) insertImageAtSelection(view, src);
          });
          return true;
        }
        // Paste a bare image URL → embed it directly.
        const text = event.clipboardData?.getData('text/plain') ?? '';
        if (isImageUrl(text)) {
          event.preventDefault();
          insertImageAtSelection(view, text.trim());
          return true;
        }
        return false;
      },
      handleDrop: (view, event) => {
        if (readOnly) return false;
        const image = Array.from(event.dataTransfer?.files ?? []).find((f) =>
          f.type.startsWith('image/'),
        );
        if (!image) return false;
        event.preventDefault();
        const pos = view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos;
        const wsId = resolveWorkspaceId(workspaceIdRef.current, dataRef.current.filePath);
        void saveImageBlob(image, wsId).then((src) => {
          if (!src) return;
          if (typeof pos === 'number') insertImageAtPos(view, src, pos);
          else insertImageAtSelection(view, src);
        });
        return true;
      },
    },
    onUpdate: ({ editor }) => {
      if (readOnly) return;
      // Coalesce the expensive serialize + nodes-array writeback (I-1).
      pendingEditorRef.current = editor;
      if (contentCommitRef.current) clearTimeout(contentCommitRef.current);
      contentCommitRef.current = setTimeout(() => commitContent(), CONTENT_COMMIT_MS);

      // Slash menu must track the caret on every keystroke — a cheap local read.
      const { from } = editor.state.selection;
      const startPos = Math.max(0, from - 60);
      const textBefore = editor.state.doc.textBetween(startPos, from, '\n', '\0');
      const slashMatch = textBefore.match(/(?:^|[\n ])\/(\w*)$/);
      if (slashMatch) {
        const query = slashMatch[1] ?? '';
        const slashDocPos = from - query.length - 1;
        const coords = editor.view.coordsAtPos(slashDocPos);
        openSlashMenu((prev) => ({
          x: coords.left,
          y: coords.bottom,
          query,
          index: prev?.query === query ? prev.index : 0,
          slashFrom: slashDocPos,
        }));
      } else {
        if (slashMenuRef.current) closeSlashMenu();
      }
    },
    onSelectionUpdate: ({ editor }) => {
      if (readOnly || editor.state.selection.empty) {
        closeBubble();
        return;
      }
      requestAnimationFrame(() => {
        const domSel = window.getSelection();
        if (!domSel || domSel.rangeCount === 0) {
          closeBubble();
          return;
        }
        const selRect = domSel.getRangeAt(0).getBoundingClientRect();
        openBubble({
          x: selRect.left + selRect.width / 2,
          y: selRect.top,
          bottom: selRect.bottom,
        });
      });
    },
    onBlur: () => {
      commitContent(true); // flush pending debounced edit before focus leaves
      closeBubble();
    },
  });

  // Flush on unmount (node deleted / workspace switched while focused).
  useEffect(() => () => commitContent(true), [commitContent]);

  // Sync content when file opens externally
  useEffect(() => {
    if (!editor || data.content === prevContentRef.current) return;
    prevContentRef.current = data.content;
    editor.commands.setContent(data.content || '', { emitUpdate: false });
    setModified(false);
  }, [data.content, editor, prevContentRef, setModified]);

  useEffect(() => {
    if (!editor) return;
    editor.setEditable(!readOnly);
    if (readOnly) {
      resetForReadOnly();
    }
  }, [editor, readOnly, resetForReadOnly]);

  // Slash menu keyboard navigation — capture phase so we intercept before ProseMirror
  useEffect(() => {
    if (!editor || readOnly) return;
    const handler = (e: KeyboardEvent) => {
      const menu = slashMenuRef.current;
      if (!menu) return;
      // Arrow/Enter/Escape during IME composition steer the candidate
      // window (e.g. a Chinese query after the slash) — leave them alone.
      if (isImeComposing(e)) return;
      const items = filterCmds(menu.query);
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        e.stopImmediatePropagation();
        moveSlashSelection(1, items.length);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        e.stopImmediatePropagation();
        moveSlashSelection(-1, items.length);
      } else if (e.key === 'Enter') {
        const item = items[menu.index] ?? items[0];
        if (item) {
          e.preventDefault();
          e.stopImmediatePropagation();
          item.run(editor, menu.slashFrom, editor.state.selection.from, slashCtxRef.current);
          closeSlashMenu();
        }
      } else if (e.key === 'Escape') {
        closeSlashMenu();
      }
    };
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [editor, readOnly, closeSlashMenu, moveSlashSelection]);

  const slashCtx: SlashCmdContext = {
    requestLink: (initial: string) => {
      if (!readOnly) openControlledLinkPrompt(initial);
    },
    requestImage: () => {
      if (!readOnly) imageInputRef.current?.click();
    },
  };
  const slashCtxRef = useRef<SlashCmdContext>(slashCtx);
  slashCtxRef.current = slashCtx;

  const handleSlashSelect = useCallback((cmd: SlashCommandDef) => {
    if (readOnly || !editor || !slashMenuRef.current) return;
    const { slashFrom } = slashMenuRef.current;
    const fullCmd = ALL_SLASH_COMMANDS.find((c) => c.id === cmd.id);
    fullCmd?.run(editor, slashFrom, editor.state.selection.from, slashCtxRef.current);
    closeSlashMenu();
  }, [editor, readOnly, closeSlashMenu, slashMenuRef]);

  const openLinkPrompt = useCallback(() => {
    if (readOnly || !editor) return;
    const initial = (editor.getAttributes('link')?.href as string | undefined) ?? '';
    openControlledLinkPrompt(initial);
  }, [editor, readOnly, openControlledLinkPrompt]);

  const applyLink = useCallback(
    (url: string) => {
      if (readOnly || !editor) return;
      const trimmed = url.trim();
      if (trimmed === '') {
        editor.chain().focus().extendMarkRange('link').unsetLink().run();
      } else {
        editor
          .chain()
          .focus()
          .extendMarkRange('link')
          .setLink({ href: trimmed })
          .run();
      }
      closeLinkPrompt();
    },
    [editor, readOnly, closeLinkPrompt],
  );

  const cancelLink = closeLinkPrompt;

  const insertImageFromFile = useCallback(
    async (file: File) => {
      if (readOnly || !editor) return;
      const wsId = resolveWorkspaceId(workspaceIdRef.current, dataRef.current.filePath);
      const src = await saveImageBlob(file, wsId);
      if (src) editor.chain().focus().setImage({ src }).run();
    },
    [editor, dataRef, workspaceIdRef, readOnly],
  );

  const openImagePicker = useCallback(() => {
    if (!readOnly) imageInputRef.current?.click();
  }, [readOnly]);

  const openNoteFindBar = useCallback(() => {
    if (!readOnly) openFindBar();
  }, [readOnly, openFindBar]);

  // Window-level note shortcuts (Cmd+S save, Cmd+F find), scoped to the focused
  // editor so they don't fire across every mounted note.
  useNoteKeyboard({
    editor,
    readOnly,
    dataRef,
    persistToFile,
    getMarkdown,
    onOpenFind: openNoteFindBar,
  });

  return {
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
    openFindBar: openNoteFindBar,
    closeFindBar,
    outlineOpen,
    toggleOutline,
    closeOutline,
  };
};
