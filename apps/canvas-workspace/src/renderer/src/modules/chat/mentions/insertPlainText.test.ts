// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { insertPlainText, plainTextToHtml } from './insertPlainText';
import { serializeEditable } from './serializeEditable';

describe('insertPlainText', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('escapes markup and turns every line ending into a <br>', () => {
    expect(plainTextToHtml('a < b && c\r\n  d > e\rf\n'))
      .toBe('a &lt; b &amp;&amp; c<br>  d &gt; e<br>f<br>');
  });

  it('round-trips multi-line text through serializeEditable', () => {
    const text = 'SELECT a,\n  b <> 1\nFROM t;';
    const element = document.createElement('div');
    element.innerHTML = plainTextToHtml(text);
    expect(serializeEditable(element)).toBe(text);
  });

  it('inserts multi-line text as one insertHTML step', () => {
    const execCommand = vi.fn(() => true);
    Object.defineProperty(document, 'execCommand', { value: execCommand, configurable: true });
    insertPlainText('one\ntwo');
    expect(execCommand).toHaveBeenCalledTimes(1);
    expect(execCommand).toHaveBeenCalledWith('insertHTML', false, 'one<br>two');
  });

  it('keeps insertText for a single line', () => {
    const execCommand = vi.fn(() => true);
    Object.defineProperty(document, 'execCommand', { value: execCommand, configurable: true });
    insertPlainText('<b>one</b>');
    expect(execCommand).toHaveBeenCalledWith('insertText', false, '<b>one</b>');
  });
});
