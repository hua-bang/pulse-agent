import { Mark, mergeAttributes } from '@tiptap/react';

export const NOTE_COLORS = {
  yellow: ['#8a6500', '#fff3bf'], green: ['#34724b', '#dff3e4'],
  cyan: ['#287781', '#dff3f5'], blue: ['#365ba6', '#e4ecff'],
  purple: ['#8053a4', '#f0e3fa'], red: ['#ab4545', '#fbe3e3'],
  gray: ['#666666', '#eeeeee'],
} as const;
export type NoteColorName = keyof typeof NOTE_COLORS;
const valid = (value: unknown): value is NoteColorName => typeof value === 'string' && Object.prototype.hasOwnProperty.call(NOTE_COLORS, value);

// Only our allowlisted inline color tags are parsed; general Markdown HTML
// remains disabled. This keeps colors portable without accepting arbitrary HTML.
export const NoteColor = Mark.create({
  name: 'noteColor',
  addAttributes() {
    return {
      color: { default: null, parseHTML: el => valid(el.dataset.noteColor) ? el.dataset.noteColor : null },
      background: { default: null, parseHTML: el => valid(el.dataset.noteBackground) ? el.dataset.noteBackground : null },
    };
  },
  parseHTML() { return [{ tag: 'span[data-note-color]' }, { tag: 'span[data-note-background]' }]; },
  renderHTML({ mark }) {
    const { color, background } = mark.attrs;
    return ['span', mergeAttributes({
      ...(valid(color) ? { 'data-note-color': color } : {}),
      ...(valid(background) ? { 'data-note-background': background } : {}),
      style: `${valid(color) ? `color:${NOTE_COLORS[color][0]};` : ''}${valid(background) ? `background-color:${NOTE_COLORS[background][1]};` : ''}`,
    }), 0];
  },
  addStorage() {
    return { markdown: {
      serialize: {
        open: (_state: unknown, mark: { attrs: Record<string, unknown> }) => {
          const { color, background } = mark.attrs;
          return `<span${valid(color) ? ` data-note-color="${color}"` : ''}${valid(background) ? ` data-note-background="${background}"` : ''}>`;
        },
        close: '</span>',
      },
      parse: {
        setup(markdown: any) {
          markdown.inline.ruler.before('html_inline', 'note_color', (state: any, silent: boolean) => {
            const match = state.src.slice(state.pos).match(/^(<span(?: data-note-(?:color|background)="(?:yellow|green|cyan|blue|purple|red|gray)"){1,2}>|<\/span>)/);
            if (!match) return false;
            const closing = match[0] === '</span>';
            if (closing && !state.noteColorDepth) return false;
            if (!silent) state.noteColorDepth = (state.noteColorDepth || 0) + (closing ? -1 : 1);
            if (!silent) { const token = state.push('html_inline', '', 0); token.content = match[0]; }
            state.pos += match[0].length;
            return true;
          });
        },
      },
    } };
  },
});
