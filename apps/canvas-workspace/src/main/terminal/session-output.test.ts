import { describe, expect, it } from 'vitest';
import {
  appendScrollback,
  dropRawScrollback,
  getSessionScrollback,
  publishSessionSnapshot,
  readSessionOutput,
} from './session-output';

describe('session output', () => {
  it('prefers the rendered snapshot over the raw redraw stream', () => {
    appendScrollback('tui', '\x1b[2K\rThinking 1\x1b[2K\rThinking 2\x1b[2K\rDone');
    publishSessionSnapshot('tui', 'Done');
    expect(getSessionScrollback('tui')).toEqual({ ok: true, text: 'Done' });
  });

  it('falls back to the ANSI-stripped stream when no snapshot was published', () => {
    appendScrollback('shell', '\x1b[32mok\x1b[0m\r\n');
    expect(getSessionScrollback('shell')).toEqual({ ok: true, text: 'ok' });
  });

  it('keeps a finished session readable after its raw stream is dropped', () => {
    appendScrollback('done', 'raw');
    publishSessionSnapshot('done', 'final output');
    dropRawScrollback('done');
    expect(readSessionOutput('done', 'saved')).toBe('final output');
  });

  it('uses the saved text only when main knows nothing about the session', () => {
    expect(readSessionOutput('unknown', 'saved')).toBe('saved');
    expect(readSessionOutput(undefined, undefined)).toBe('');
  });

  it('retains a bounded number of snapshots, evicting the oldest', () => {
    for (let index = 0; index < 70; index += 1) publishSessionSnapshot(`s-${index}`, `out ${index}`);
    expect(getSessionScrollback('s-0').ok).toBe(false);
    expect(getSessionScrollback('s-69')).toEqual({ ok: true, text: 'out 69' });
  });
});
