import { describe, expect, it } from 'vitest';
import { applyStringEdits } from './string-edits';

describe('applyStringEdits', () => {
  it('applies a single unique edit', () => {
    const result = applyStringEdits('<h1>Old title</h1>', [
      { old_str: 'Old title', new_str: 'New title' },
    ]);
    expect(result).toEqual({ ok: true, content: '<h1>New title</h1>' });
  });

  it('applies edits sequentially — later edits see earlier results', () => {
    const result = applyStringEdits('<p>alpha</p>', [
      { old_str: 'alpha', new_str: 'beta' },
      { old_str: '<p>beta</p>', new_str: '<p>beta</p><p>gamma</p>' },
    ]);
    expect(result).toEqual({ ok: true, content: '<p>beta</p><p>gamma</p>' });
  });

  it('rejects an old_str that does not match', () => {
    const result = applyStringEdits('<p>hello</p>', [
      { old_str: 'missing', new_str: 'x' },
    ]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('not found');
  });

  it('rejects an ambiguous old_str', () => {
    const result = applyStringEdits('<li>a</li><li>a</li>', [
      { old_str: '<li>a</li>', new_str: '<li>b</li>' },
    ]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('2 times');
  });

  it('rejects empty old_str and empty edit lists', () => {
    expect(applyStringEdits('x', [{ old_str: '', new_str: 'y' }]).ok).toBe(false);
    expect(applyStringEdits('x', []).ok).toBe(false);
  });

  it('does not treat replacement-string $ patterns specially', () => {
    const result = applyStringEdits('price: OLD', [
      { old_str: 'OLD', new_str: "$100 & $'quoted'" },
    ]);
    expect(result).toEqual({ ok: true, content: "price: $100 & $'quoted'" });
  });
});
