import { describe, expect, it } from 'vitest';
import { renderBundleReportHtml } from './bundle-report-html.mjs';

describe('bundle report chunk labels', () => {
  it('marks only the explicitly measured renderer entry', () => {
    const html = renderBundleReportHtml({
      commit: 'abc1234',
      generatedAt: '2026-07-11T00:00:00.000Z',
      entryChunkFileName: 'index-entry.js',
      metrics: {
        entryRawKB: 600,
        entryGzipKB: 180,
        totalJsKB: 900,
        chunkCount: 2,
      },
      gates: [],
      probes: [],
      topChunks: [
        { name: 'index-entry.js', rawKB: 600 },
        { name: 'index-lazy.js', rawKB: 280 },
      ],
    });

    expect(html.match(/class="bar-tag">entry<\/span>/g)).toHaveLength(1);
    expect(html).toContain('index-lazy.js — 280 KB raw (lazy chunk)');
  });
});
