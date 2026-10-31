import { describe, expect, it } from 'vitest';
import { estimateNoteHeight, MAX_NOTE_HEIGHT, MIN_NOTE_HEIGHT } from './content-size';

describe('estimateNoteHeight', () => {
  it('keeps a short card short and grows with content up to the cap', () => {
    const short = estimateNoteHeight('# Claim\n\n- one point', 360);
    const medium = estimateNoteHeight(['# Claim', '', ...Array.from({ length: 8 }, (_, i) => `- support point ${i} with a source id [S${i}]`)].join('\n'), 360);
    const long = estimateNoteHeight('word '.repeat(2000), 360);

    expect(short).toBeGreaterThanOrEqual(MIN_NOTE_HEIGHT);
    expect(medium).toBeGreaterThan(short);
    expect(medium).toBeLessThan(MAX_NOTE_HEIGHT);
    expect(long).toBe(MAX_NOTE_HEIGHT);
  });

  it('matches reading-card heights measured in the renderer', () => {
    // Measured in the app: border, title header and the editor's height.
    // The leading heading repeats the title, so the card hides it.
    // It may run up to two 8px steps tall, never short: short shows a scrollbar.
    const near = (estimate: number, measured: number) => {
      expect(estimate).toBeGreaterThanOrEqual(measured);
      expect(estimate - measured).toBeLessThanOrEqual(16);
    };
    near(estimateNoteHeight('# IDC 2026 Q2\n\n端侧 AI 设备追踪报告，包含**出货量**与份额数据。', 520, 'IDC 2026 Q2'), 170);
    near(estimateNoteHeight('# 手机侧格局已基本稳定\n\n- 高通、联发科、苹果合计占手机端 **八成以上** 份额。\n- 新进入者难以撼动，集中在低功耗推理细分市场。\n- 后续只需按季度跟踪份额变化。', 640, '手机侧格局已基本稳定'), 246);
  });

  it('counts the title and skips a heading that repeats it', () => {
    const body = '- one point\n- another point';
    const titled = estimateNoteHeight(body, 360, 'A claim');
    expect(estimateNoteHeight(`# A claim\n\n${body}`, 360, 'A claim')).toBe(titled);
    expect(estimateNoteHeight(body, 360, 'A claim that runs long enough to wrap onto more lines in a narrow card'))
      .toBeGreaterThan(titled);
  });

  it('treats CJK text as wider than Latin text and narrow cards as taller', () => {
    const latin = estimateNoteHeight('a'.repeat(400), 360);
    const cjk = estimateNoteHeight('研'.repeat(400), 360);

    expect(cjk).toBeGreaterThan(latin);
    expect(estimateNoteHeight('a'.repeat(400), 240)).toBeGreaterThan(estimateNoteHeight('a'.repeat(400), 520));
  });
});
