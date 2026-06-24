import { useEffect } from 'react';
import type { Editor } from '@tiptap/react';
import type { FileNodeData } from '../types';

interface Options {
  editor: Editor | null;
  readOnly: boolean;
  dataRef: React.MutableRefObject<FileNodeData>;
  persistToFile: (markdown: string, filePath: string) => Promise<void>;
  getMarkdown: (editor: Editor) => string;
  onOpenFind: () => void;
}

/**
 * Window-level note shortcuts (Cmd/Ctrl+S to save, Cmd/Ctrl+F to find), scoped
 * to the focused editor. With multiple notes mounted on the canvas every editor
 * attaches its own listener; gating on `editor.isFocused` ensures a shortcut
 * only acts on the note the user is actually editing — previously Cmd+S saved
 * every open note at once.
 */
export const useNoteKeyboard = ({
  editor,
  readOnly,
  dataRef,
  persistToFile,
  getMarkdown,
  onOpenFind,
}: Options) => {
  useEffect(() => {
    if (!editor || readOnly) return;
    const handler = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      const key = e.key.toLowerCase();
      if (key !== 's' && key !== 'f') return;
      // Only the focused note responds, so shortcuts don't fan out across
      // every mounted editor.
      if (!editor.isFocused) return;
      e.preventDefault();
      if (key === 's') {
        const fp = dataRef.current.filePath;
        if (fp) void persistToFile(getMarkdown(editor), fp);
      } else {
        onOpenFind();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [editor, readOnly, dataRef, persistToFile, getMarkdown, onOpenFind]);
};
