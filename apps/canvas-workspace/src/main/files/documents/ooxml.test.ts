import { strToU8, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { readZipParts } from './ooxml';

describe('readZipParts', () => {
  it('reads only the wanted parts', () => {
    const bytes = zipSync({ 'a.xml': strToU8('<a/>'), 'b.xml': strToU8('<b/>') });
    expect(Array.from(readZipParts(bytes, (name) => name === 'a.xml'))).toEqual([['a.xml', '<a/>']]);
  });

  // A few hundred KiB on disk that would inflate to more than the per-part limit.
  it('refuses a part that would inflate past the size limit', () => {
    const bytes = zipSync({ 'word/document.xml': new Uint8Array(65 * 1024 * 1024) });
    expect(bytes.length).toBeLessThan(1024 * 1024);
    expect(() => readZipParts(bytes, () => true)).toThrow(/too large/);
    expect(readZipParts(bytes, () => false).size).toBe(0);
  });
});
