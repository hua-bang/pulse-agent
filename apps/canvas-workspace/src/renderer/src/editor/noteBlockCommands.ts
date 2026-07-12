import type { Editor } from '@tiptap/react';
import { TextSelection } from '@tiptap/pm/state';

const currentTopLevelBlock = (editor: Editor) => {
  const { $from } = editor.state.selection;
  const index = $from.index(0);
  const node = editor.state.doc.child(index);
  const from = $from.before(1);
  return { index, node, from };
};

export const moveCurrentNoteBlock = (editor: Editor, direction: -1 | 1): boolean => {
  const { doc, tr } = editor.state;
  const { index, node, from } = currentTopLevelBlock(editor);
  const targetIndex = index + direction;
  if (targetIndex < 0 || targetIndex >= doc.childCount) return false;

  const sibling = doc.child(targetIndex);
  const insertAt = direction < 0 ? from - sibling.nodeSize : from + sibling.nodeSize;
  tr.delete(from, from + node.nodeSize);
  tr.insert(insertAt, node);
  tr.setSelection(TextSelection.near(tr.doc.resolve(Math.min(insertAt + 1, tr.doc.content.size))));
  editor.view.dispatch(tr.scrollIntoView());
  return true;
};

export const duplicateCurrentNoteBlock = (editor: Editor): boolean => {
  const { tr } = editor.state;
  const { node, from } = currentTopLevelBlock(editor);
  const insertAt = from + node.nodeSize;
  tr.insert(insertAt, node.copy(node.content));
  tr.setSelection(TextSelection.near(tr.doc.resolve(Math.min(insertAt + 1, tr.doc.content.size))));
  editor.view.dispatch(tr.scrollIntoView());
  return true;
};
