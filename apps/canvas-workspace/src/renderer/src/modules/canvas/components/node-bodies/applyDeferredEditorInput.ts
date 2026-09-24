import type { Editor } from '@tiptap/react';
import { DOMParser as EditorDOMParser } from '@tiptap/pm/model';
import type { DeferredEditorInput } from './useDeferredEditorInput';

export type DeferredEditorReady = (handoff: (pending: DeferredEditorInput) => void | boolean) => () => void;

/** Commit the brief loading buffer through the existing editor schema/onUpdate. */
export function applyDeferredEditorInput(
  editor: Editor,
  pending: DeferredEditorInput,
  viewport?: Element | null,
): boolean {
  if (editor.isDestroyed) throw new Error('The editor is no longer available');
  const point = pending.point;
  if (viewport && point) viewport.scrollTop = point.scrollTop;
  const position = point
    ? editor.view.posAtCoords({ left: point.x, top: point.y })?.pos ?? 'end'
    : 'end';
  editor.commands.focus(position);
  // File editors accept user updates only while focused. Tiptap defers DOM
  // focus to rAF, so transfer it before insertion as well as before hiding.
  editor.view.focus();
  for (const deletion of pending.deletions) {
    editor.commands.keyboardShortcut(deletion === 'backward' ? 'Backspace' : 'Delete');
  }
  if (pending.html) {
    // The Markdown extension overrides string insertContent. Parse this already
    // sanitized native input as HTML with the existing editor schema instead.
    const dom = new DOMParser().parseFromString(pending.html, 'text/html');
    const slice = EditorDOMParser.fromSchema(editor.schema).parseSlice(dom.body, { preserveWhitespace: 'full' });
    editor.view.dispatch(editor.state.tr.replaceSelection(slice).scrollIntoView());
  }
  if (editor.isDestroyed) return false;
  editor.view.focus();
  return true;
}
