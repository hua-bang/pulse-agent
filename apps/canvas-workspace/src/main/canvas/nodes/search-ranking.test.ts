import { describe, expect, it } from 'vitest';
import { queryTerms, scoreNode, snippetAround } from './search-ranking';

describe('canvas node search ranking', () => {
  it('splits words and CJK runs into terms', () => {
    expect(queryTerms('Pricing  strategy')).toEqual(['pricing', 'strategy']);
    expect(queryTerms('定价策略')).toEqual(['定价', '价策', '策略']);
    expect(queryTerms('AI 定价')).toEqual(['ai', '定价']);
    expect(queryTerms('   ')).toEqual([]);
  });

  it('matches multi-word and unspaced CJK queries that a phrase match misses', () => {
    const pricing = { title: 'Notes', body: 'Our strategy for pricing the API' };
    expect(scoreNode(pricing, 'pricing strategy', queryTerms('pricing strategy'))?.matchedTerms).toBe(2);

    const cjk = { title: '会议纪要', body: '讨论了定价和策略' };
    expect(scoreNode(cjk, '定价策略', queryTerms('定价策略'))?.matchedTerms).toBe(2);

    expect(scoreNode({ title: 'Roadmap', body: 'Q3 plan' }, 'pricing', ['pricing'])).toBeNull();
  });

  it('ranks title matches and exact phrases above body mentions', () => {
    const terms = queryTerms('pricing model');
    const titled = scoreNode({ title: 'Pricing model', body: '' }, 'pricing model', terms)!;
    const mentioned = scoreNode({ title: 'Notes', body: 'the pricing model is open' }, 'pricing model', terms)!;
    const scattered = scoreNode({ title: 'Notes', body: 'model of pricing' }, 'pricing model', terms)!;

    expect(titled.score).toBeGreaterThan(mentioned.score);
    expect(mentioned.score).toBeGreaterThan(scattered.score);
  });

  it('cuts the snippet around the match', () => {
    const text = `${'intro '.repeat(60)}the key finding is here ${'tail '.repeat(60)}`;
    const snippet = snippetAround(text, text.indexOf('key finding'));

    expect(snippet).toContain('key finding');
    expect(snippet.startsWith('...')).toBe(true);
    expect(snippet.length).toBeLessThanOrEqual(166);
    expect(snippetAround('short text', 0)).toBe('short text');
  });
});
