import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { matchesEntryDepStats, measureRendererBundle } from './bundle-measurements.mjs';

const tempRoots = [];
afterEach(() => {
  for (const root of tempRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

const makeTempRoot = () => {
  const root = mkdtempSync(join(tmpdir(), 'canvas-bundle-measurements-'));
  tempRoots.push(root);
  return root;
};

const writeSizedFile = (root, relativePath, bytes, fill = 'x') => {
  const path = join(root, relativePath);
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, fill.repeat(bytes));
};

describe('measureRendererBundle', () => {
  it('measures the manifest entry and its deduplicated static JS/CSS closure', () => {
    const root = makeTempRoot();
    writeSizedFile(root, 'assets/small-index.js', 900);
    writeSizedFile(root, 'assets/real-entry.js', 2048);
    writeSizedFile(root, 'assets/shared.js', 1024);
    writeSizedFile(root, 'assets/lazy.js', 4096);
    writeSizedFile(root, 'assets/entry.css', 512, 'a');
    writeSizedFile(root, 'assets/shared.css', 256, 'b');
    writeSizedFile(root, 'assets/lazy.css', 1024, 'c');

    const manifest = {
      'src/renderer.tsx': {
        file: 'assets/real-entry.js',
        isEntry: true,
        imports: ['_shared.js'],
        dynamicImports: ['src/lazy.tsx'],
        css: ['assets/entry.css', 'assets/shared.css'],
      },
      '_shared.js': {
        file: 'assets/shared.js',
        css: ['assets/shared.css'],
      },
      'src/lazy.tsx': {
        file: 'assets/lazy.js',
        isDynamicEntry: true,
        css: ['assets/lazy.css'],
      },
    };

    const result = measureRendererBundle({ rendererDir: root, manifest });

    expect(result.entry.file).toBe('assets/real-entry.js');
    expect(result.entry.rawBytes).toBe(2048);
    expect(result.startup.jsFiles).toEqual(['assets/real-entry.js', 'assets/shared.js']);
    expect(result.startup.cssFiles).toEqual(['assets/entry.css', 'assets/shared.css']);
    expect(result.startup.jsRawBytes).toBe(3072);
    expect(result.startup.cssRawBytes).toBe(768);
    expect(result.startup.requestCount).toBe(4);
    expect(result.total.jsRawBytes).toBe(8068);
    expect(result.total.cssRawBytes).toBe(1792);
  });

  it('rejects manifests without one unambiguous entry', () => {
    const root = makeTempRoot();
    expect(() => measureRendererBundle({ rendererDir: root, manifest: {} }))
      .toThrow('exactly one renderer entry');
  });

  it('accepts dependency attribution only for the exact entry content', () => {
    const entry = { file: 'assets/index-abc.js', sourceSha256: 'current-build-hash' };
    expect(matchesEntryDepStats({
      chunkFileName: entry.file,
      entrySourceSha256: entry.sourceSha256,
    }, entry)).toBe(true);
    expect(matchesEntryDepStats({
      chunkFileName: entry.file,
      entrySourceSha256: 'stale-build-hash',
    }, entry)).toBe(false);
  });
});
