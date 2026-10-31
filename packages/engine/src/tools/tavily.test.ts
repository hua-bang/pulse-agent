import { afterEach, describe, expect, it, vi } from 'vitest';
import { TavilyTool } from './tavily';

describe('TavilyTool', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    delete process.env.TAVILY_API_KEY;
  });

  it('forwards research options and returns published dates', async () => {
    process.env.TAVILY_API_KEY = 'test-key';
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      results: [
        { title: 'Release notes', url: 'https://example.com/a', content: 'v2 shipped', score: 0.9, published_date: '2026-10-01' },
        { title: 'Docs', url: 'https://example.com/b', content: 'reference', score: 0.5 },
      ],
    }), { status: 200 }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const output = await TavilyTool.execute({
      query: 'example v2 release',
      maxResults: 8,
      searchDepth: 'advanced',
      topic: 'news',
      timeRange: 'month',
      includeDomains: ['example.com'],
      excludeDomains: [],
    });

    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body).toMatchObject({
      query: 'example v2 release',
      max_results: 8,
      search_depth: 'advanced',
      topic: 'news',
      time_range: 'month',
      include_domains: ['example.com'],
    });
    expect(body).not.toHaveProperty('exclude_domains');
    expect(output.results[0]).toMatchObject({ title: 'Release notes', publishedDate: '2026-10-01' });
    expect(output.results[1]).not.toHaveProperty('publishedDate');
  });

  it('keeps the basic depth by default', async () => {
    process.env.TAVILY_API_KEY = 'test-key';
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ results: [] }), { status: 200 }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await TavilyTool.execute({ query: 'anything' });

    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toMatchObject({ search_depth: 'basic', max_results: 5 });
  });
});
