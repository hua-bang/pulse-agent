/**
 * Ask a mounted canvas to add a markdown note. Chat uses this to keep an
 * assistant reply on the canvas.
 *
 * The canvas route stays mounted while other routes show, so the canvas of
 * a visited workspace is listening. The listener sets `handled`; listeners
 * run during `dispatchEvent`, so the caller knows the result at once.
 */
export const ADD_CANVAS_NOTE_EVENT = 'canvas:add-note';

export interface AddCanvasNoteDetail {
  workspaceId: string;
  title: string;
  content: string;
  /**
   * Canvas nodes the question referenced. The canvas places the note next to
   * the first one it holds and connects them with an edge.
   */
  sourceNodeIds?: string[];
  /** Set by the canvas that added the note. */
  handled: boolean;
}

const MAX_TITLE_LENGTH = 48;

/** A short note title: the first heading or line of the markdown, without markup. */
export const noteTitleFromMarkdown = (content: string, fallback: string): string => {
  const line = content
    .split('\n')
    .map((text) => text.replace(/^\s*(#{1,6}\s+|[-*+]\s+|>\s*|\d+\.\s+)/, ''))
    .map((text) => text.replace(/[*_`~[\]]/g, '').trim())
    .find((text) => text.length > 0);
  if (!line) return fallback;
  return line.length > MAX_TITLE_LENGTH ? `${line.slice(0, MAX_TITLE_LENGTH).trimEnd()}…` : line;
};

/** Returns true when a mounted canvas of `workspaceId` added the note. */
export const requestAddCanvasNote = (input: Omit<AddCanvasNoteDetail, 'handled'>): boolean => {
  const detail: AddCanvasNoteDetail = { ...input, handled: false };
  window.dispatchEvent(new CustomEvent<AddCanvasNoteDetail>(ADD_CANVAS_NOTE_EVENT, { detail }));
  return detail.handled;
};
