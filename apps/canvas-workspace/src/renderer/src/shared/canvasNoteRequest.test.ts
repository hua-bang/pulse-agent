import { describe, expect, it } from 'vitest';
import { noteTitleFromMarkdown } from './canvasNoteRequest';

describe('noteTitleFromMarkdown', () => {
  it('uses the first heading without markup', () => {
    expect(noteTitleFromMarkdown('\n## **Plan** for `v2`\n\nbody', 'AI reply')).toBe('Plan for v2');
  });

  it('strips list and quote markers', () => {
    expect(noteTitleFromMarkdown('- first item\n- second', 'AI reply')).toBe('first item');
    expect(noteTitleFromMarkdown('> quoted', 'AI reply')).toBe('quoted');
  });

  it('shortens a long first line', () => {
    const title = noteTitleFromMarkdown('a'.repeat(80), 'AI reply');
    expect(title).toHaveLength(49);
    expect(title.endsWith('…')).toBe(true);
  });

  it('falls back when the reply has no text', () => {
    expect(noteTitleFromMarkdown('  \n\n', 'AI reply')).toBe('AI reply');
  });
});
