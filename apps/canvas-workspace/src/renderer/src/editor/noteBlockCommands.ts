import type { Editor } from '@tiptap/react';
import { TextSelection } from '@tiptap/pm/state';

const currentTopLevelBlock = (editor: Editor) => {
  const { $from } = editor.state.selection;
  const index = $from.index(0);
  const node = editor.state.doc.child(index);
  const from = $from.before(1);
  return { index, node, from };
};

const topLevelBlockAt = (editor: Editor, index?: number) => {
  if (index === undefined) return currentTopLevelBlock(editor);
  if (index < 0 || index >= editor.state.doc.childCount) return null;
  let from = 0;
  for (let current = 0; current < index; current += 1) {
    from += editor.state.doc.child(current).nodeSize;
  }
  return { index, node: editor.state.doc.child(index), from };
};

export const moveNoteBlockToIndex = (editor: Editor, fromIndex: number, toIndex: number): boolean => {
  const block = topLevelBlockAt(editor, fromIndex);
  if (!block) return false;
  const maxIndex = editor.state.doc.childCount - 1;
  const finalIndex = Math.max(0, Math.min(toIndex, maxIndex));
  if (finalIndex === fromIndex) return false;

  const { tr } = editor.state;
  tr.delete(block.from, block.from + block.node.nodeSize);
  let insertAt = 0;
  for (let current = 0; current < finalIndex; current += 1) {
    insertAt += tr.doc.child(current).nodeSize;
  }
  tr.insert(insertAt, block.node);
  tr.setSelection(TextSelection.near(tr.doc.resolve(Math.min(insertAt + 1, tr.doc.content.size))));
  editor.view.dispatch(tr.scrollIntoView());
  return true;
};

export const moveCurrentNoteBlock = (editor: Editor, direction: -1 | 1, index?: number): boolean => {
  const { doc, tr } = editor.state;
  const block = topLevelBlockAt(editor, index);
  if (!block) return false;
  const targetIndex = block.index + direction;
  if (targetIndex < 0 || targetIndex >= doc.childCount) return false;

  const sibling = doc.child(targetIndex);
  const insertAt = direction < 0 ? block.from - sibling.nodeSize : block.from + sibling.nodeSize;
  tr.delete(block.from, block.from + block.node.nodeSize);
  tr.insert(insertAt, block.node);
  tr.setSelection(TextSelection.near(tr.doc.resolve(Math.min(insertAt + 1, tr.doc.content.size))));
  editor.view.dispatch(tr.scrollIntoView());
  return true;
};

export const duplicateCurrentNoteBlock = (editor: Editor, index?: number): boolean => {
  const { tr } = editor.state;
  const block = topLevelBlockAt(editor, index);
  if (!block) return false;
  const insertAt = block.from + block.node.nodeSize;
  tr.insert(insertAt, block.node.copy(block.node.content));
  tr.setSelection(TextSelection.near(tr.doc.resolve(Math.min(insertAt + 1, tr.doc.content.size))));
  editor.view.dispatch(tr.scrollIntoView());
  return true;
};

export const deleteNoteBlock = (editor: Editor, index?: number): boolean => {
  const block = topLevelBlockAt(editor, index);
  if (!block) return false;
  const { tr } = editor.state;
  if (tr.doc.childCount === 1) {
    const paragraph = editor.schema.nodes.paragraph?.create();
    if (!paragraph) return false;
    tr.replaceWith(block.from, block.from + block.node.nodeSize, paragraph);
  } else {
    tr.delete(block.from, block.from + block.node.nodeSize);
  }
  tr.setSelection(TextSelection.near(tr.doc.resolve(Math.min(block.from + 1, tr.doc.content.size))));
  editor.view.dispatch(tr.scrollIntoView());
  return true;
};
