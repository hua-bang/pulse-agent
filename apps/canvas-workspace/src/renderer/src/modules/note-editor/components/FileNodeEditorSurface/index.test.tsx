// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { NoteInteractionController } from '../../../../hooks/useNoteInteractionController';
import { I18nProvider } from '../../../../i18n';
import type { CanvasNode } from '../../../../types';
import { FileNodeEditorSurface } from '.';

vi.mock('@tiptap/react', async (importOriginal) => {
  const original = await importOriginal<typeof import('@tiptap/react')>();
  return {
    ...original,
    EditorContent: () => null,
  };
});

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLDivElement | null = null;
let editorMountTarget: HTMLDivElement | null = null;
let editor: Editor | null = null;

afterEach(() => {
  if (root) act(() => root?.unmount());
  editor?.destroy();
  host?.remove();
  editorMountTarget?.remove();
  root = null;
  host = null;
  editorMountTarget = null;
  editor = null;
});

const createInteractions = (
  slashMenu: NoteInteractionController['slashMenu'] = null,
): NoteInteractionController => ({
  slashMenu,
  slashMenuRef: { current: null },
  openSlashMenu: vi.fn(),
  closeSlashMenu: vi.fn(),
  moveSlashSelection: vi.fn(),
  mentionMenu: null,
  mentionMenuRef: { current: null },
  openMentionMenu: vi.fn(),
  closeMentionMenu: vi.fn(),
  moveMentionSelection: vi.fn(),
  bubble: null,
  openBubble: vi.fn(),
  closeBubble: vi.fn(),
  linkPrompt: null,
  openLinkPrompt: vi.fn(),
  closeLinkPrompt: vi.fn(),
  findBarOpen: false,
  openFindBar: vi.fn(),
  closeFindBar: vi.fn(),
  outlineOpen: false,
  toggleOutline: vi.fn(),
  closeOutline: vi.fn(),
  closeEditorTransientSurfaces: vi.fn(),
  resetForReadOnly: vi.fn(),
});

describe('FileNodeEditorSurface', () => {
  it('closes caret-anchored surfaces when the editor body scrolls', () => {
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
    const interactions = createInteractions({
      x: 20,
      y: 20,
      query: '',
      index: 0,
      slashFrom: 1,
    });
    interactions.mentionMenu = {
      x: 24,
      y: 30,
      query: '',
      index: 0,
    };
    interactions.bubble = {
      x: 60,
      y: 70,
      bottom: 82,
    };
    const closeMention = vi.fn();

    act(() => root?.render(
      <I18nProvider>
        <FileNodeEditorSurface
          editor={null}
          readOnly={false}
          cardRef={{ current: document.createElement('div') }}
          interactions={interactions}
          handleSlashSelect={vi.fn()}
          openLinkPrompt={vi.fn()}
          applyLink={vi.fn()}
          cancelLink={vi.fn()}
          imageInputRef={{ current: null }}
          onImageInputChange={vi.fn()}
          onLinkClickCapture={vi.fn()}
          filteredMentions={[]}
          insertMention={vi.fn()}
          closeMention={closeMention}
        />
      </I18nProvider>,
    ));

    const content = document.querySelector('.note-content');
    const editorScroller = document.createElement('div');
    editorScroller.className = 'note-tiptap-editor';
    content?.append(editorScroller);
    act(() => {
      editorScroller.dispatchEvent(new Event('scroll', { bubbles: false }));
    });

    expect(interactions.closeBubble).toHaveBeenCalledTimes(1);
    expect(interactions.closeSlashMenu).toHaveBeenCalledTimes(1);
    expect(closeMention).toHaveBeenCalledTimes(1);
  });

  it('does not access editor.view before EditorContent mounts it', () => {
    host = document.createElement('div');
    document.body.append(host);
    editor = new Editor({
      element: null,
      extensions: [StarterKit],
      content: '<p>Unmounted editor</p>',
    });
    editorMountTarget = document.createElement('div');
    document.body.append(editorMountTarget);
    root = createRoot(host);

    expect(() => {
      act(() => root?.render(
        <FileNodeEditorSurface
          editor={editor}
          readOnly
          cardRef={{ current: document.createElement('div') }}
          interactions={createInteractions({
            x: 20,
            y: 20,
            query: '',
            index: 0,
            slashFrom: 1,
          })}
          handleSlashSelect={vi.fn()}
          openLinkPrompt={vi.fn()}
          applyLink={vi.fn()}
          cancelLink={vi.fn()}
          imageInputRef={{ current: null }}
          onImageInputChange={vi.fn()}
          onLinkClickCapture={vi.fn()}
          filteredMentions={[]}
          insertMention={vi.fn()}
          closeMention={vi.fn()}
        />,
      ));
    }).not.toThrow();

    expect(editor.isInitialized).toBe(false);
    act(() => editor?.mount(editorMountTarget!));
    expect(editor.view.dom.getAttribute('aria-expanded')).toBe('true');
    expect(editor.view.dom.getAttribute('aria-activedescendant')).toMatch(/-text$/);

    const mountedDom = editor.view.dom;
    act(() => editor?.unmount());
    expect(mountedDom.hasAttribute('aria-expanded')).toBe(false);
    expect(mountedDom.hasAttribute('aria-activedescendant')).toBe(false);
  });

  it('connects the editor to the active mention listbox option', () => {
    host = document.createElement('div');
    document.body.append(host);
    editorMountTarget = document.createElement('div');
    document.body.append(editorMountTarget);
    editor = new Editor({
      element: editorMountTarget,
      extensions: [StarterKit],
      content: '<p>@Alpha</p>',
    });
    root = createRoot(host);
    const interactions = createInteractions();
    interactions.mentionMenu = {
      x: 20,
      y: 20,
      query: 'Alpha',
      index: 0,
    };
    const mention = {
      id: 'node-alpha',
      type: 'file',
      title: 'Alpha note',
    } as CanvasNode;

    act(() => root?.render(
      <I18nProvider>
        <FileNodeEditorSurface
          editor={editor}
          readOnly={false}
          cardRef={{ current: document.createElement('div') }}
          interactions={interactions}
          handleSlashSelect={vi.fn()}
          openLinkPrompt={vi.fn()}
          applyLink={vi.fn()}
          cancelLink={vi.fn()}
          imageInputRef={{ current: null }}
          onImageInputChange={vi.fn()}
          onLinkClickCapture={vi.fn()}
          filteredMentions={[mention]}
          insertMention={vi.fn()}
          closeMention={vi.fn()}
        />
      </I18nProvider>,
    ));

    const controls = editor.view.dom.getAttribute('aria-controls');
    const activeDescendant = editor.view.dom.getAttribute('aria-activedescendant');
    expect(editor.view.dom.getAttribute('aria-haspopup')).toBe('listbox');
    expect(editor.view.dom.getAttribute('aria-expanded')).toBe('true');
    expect(activeDescendant).toBe(`${controls}-node-alpha`);
    expect(document.getElementById(activeDescendant!)).not.toBeNull();
  });
});
