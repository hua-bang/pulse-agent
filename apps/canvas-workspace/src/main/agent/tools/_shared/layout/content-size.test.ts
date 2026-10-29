import { describe, expect, it } from 'vitest';
import { estimateNoteHeight, MAX_NOTE_HEIGHT, MIN_NOTE_HEIGHT } from './content-size';

describe('estimateNoteHeight', () => {
  it('keeps a short card short and grows with content up to the cap', () => {
    const short = estimateNoteHeight('# Claim\n\n- one point', 360);
    const medium = estimateNoteHeight(['# Claim', '', ...Array.from({ length: 8 }, (_, i) => `- support point ${i} with a source id [S${i}]`)].join('\n'), 360);
    const long = estimateNoteHeight('word '.repeat(2000), 360);

    expect(short).toBe(MIN_NOTE_HEIGHT);
    expect(medium).toBeGreaterThan(short);
    expect(medium).toBeLessThan(MAX_NOTE_HEIGHT);
    expect(long).toBe(MAX_NOTE_HEIGHT);
  });

  it('treats CJK text as wider than Latin text and narrow cards as taller', () => {
    const latin = estimateNoteHeight('a'.repeat(400), 360);
    const cjk = estimateNoteHeight('研'.repeat(400), 360);

    expect(cjk).toBeGreaterThan(latin);
    expect(estimateNoteHeight('a'.repeat(400), 240)).toBeGreaterThan(estimateNoteHeight('a'.repeat(400), 520));
  });
});
