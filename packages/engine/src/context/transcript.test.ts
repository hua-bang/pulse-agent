import { describe, expect, it } from 'vitest';
import { estimateTextTokens } from './estimate';
import { fitTranscript } from './transcript';

describe('fitTranscript', () => {
  it.each([32_000, 6_400])('bounds mixed-density history at %i estimated tokens', (budget) => {
    const transcript = '中'.repeat(25_000) + 'a'.repeat(900_000) + '文'.repeat(75_000);
    const fitted = fitTranscript(transcript, budget);

    expect(estimateTextTokens(fitted)).toBeLessThanOrEqual(budget);
    expect(fitted).toMatch(/^中+\n…\[\d+ chars of history omitted\]…\n文+$/);
  });

  it('returns text unchanged when it fits exactly', () => {
    expect(fitTranscript('ab中文', 3)).toBe('ab中文');
    expect(fitTranscript('', 0)).toBe('');
  });

  it('counts the omission marker and handles small and fractional budgets', () => {
    for (const transcript of ['a'.repeat(120), '中'.repeat(120), 'ab中'.repeat(120)]) {
      for (const budget of [-1, 0, 0.5, 1, 8, 10, 12, 15.5, 20, 29, 30, 31, 99, 100, 119]) {
        const fitted = fitTranscript(transcript, budget);
        expect(estimateTextTokens(fitted)).toBeLessThanOrEqual(Math.max(0, Math.floor(budget)));
        if (!fitted || fitted === transcript) continue;
        const match = fitted.match(/^(.*)\n…\[(\d+) chars of history omitted\]…\n(.*)$/s)!;
        expect(match).not.toBeNull();
        expect(transcript.startsWith(match[1])).toBe(true);
        expect(transcript.endsWith(match[3])).toBe(true);
        expect(match[1].length).toBe(Math.floor((match[1].length + match[3].length) * 0.25));
        expect(Number(match[2]) + match[1].length + match[3].length).toBe(transcript.length);
      }
    }
  });
});
