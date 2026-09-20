import { describe, expect, it, vi } from 'vitest';
import { createJevDecision, decisionRequest, parseDecision } from './decision';
import type { PageSnapshot, PageStep } from './types';
import { buildActions } from './runner';

const page: PageSnapshot = { id: 's', documentId: 'd', fingerprint: 'f', url: 'https://example.test', title: '', text: '', targets: [], truncated: false, scrollUp: false, scrollDown: false };
function response() {
  return { model: 'jev-1.13', answers: {
    action: { type: 'choice', choice: 'done', confidence: 0.9, probabilities: { done: 0.9, blocked: 0.1 } },
    goal_done: { type: 'noul', noul: 0.99 }, stuck: { type: 'noul', noul: 0.01 },
  }, usage: { input_tokens: 20, output_tokens: 3 } };
}

describe('Jev browser decision contract', () => {
  it('validates distribution membership and numeric bounds before any action', () => {
    expect(parseDecision(response(), ['done', 'blocked'])).toMatchObject({ action: 'done', inputTokens: 20 });
    const outside = response();
    outside.answers.action.choice = 'page_eval';
    expect(() => parseDecision(outside, ['done', 'blocked'])).toThrow();
    const invalid = response();
    invalid.answers.goal_done.noul = 1.1;
    expect(() => parseDecision(invalid, ['done', 'blocked'])).toThrow();
    expect(() => parseDecision(response(), ['done', 'blocked', 'wait'])).toThrow();
    const low = response();
    low.answers.action.choice = 'blocked';
    expect(() => parseDecision(low, ['done', 'blocked'])).toThrow();
  });

  it('sends all three independent questions and a bounded recent trace', () => {
    const body = decisionRequest('Find a page', page, [], []);
    expect(Object.keys(body.questions)).toEqual(['action', 'goal_done', 'stuck']);
    expect(body.questions.action.criteria).toHaveProperty('unsupported');
    expect(body.questions.action.instructions).toContain('Filling does not submit');
  });

  it('does not advertise model completion while selecting a reading region', () => {
    const body = decisionRequest('Read', { ...page, readingMode: true }, [
      { id: 'scroll_down', kind: 'scroll_down', description: 'Read current root to bottom' },
    ], []);
    expect(body.state.mode).toBe('select_reading_region');
    expect(Object.keys(body.questions.action.criteria)).toEqual(['scroll_down', 'blocked', 'unsupported']);
  });

  it('passes cancellation to the transport without exposing key or response body in errors', async () => {
    const fetcher = vi.fn<Parameters<typeof fetch>, ReturnType<typeof fetch>>().mockResolvedValue(new Response('server secret body', { status: 401 }));
    const ask = createJevDecision('private-test-key', fetcher);
    await expect(ask('Read', page, [], [], new AbortController().signal)).rejects.toThrow('HTTP 401');
    expect(fetcher.mock.calls[0][1]).toMatchObject({ redirect: 'error', signal: expect.any(AbortSignal) });
  });
});

describe('Jev request size and failure diagnostics', () => {
  it('bounds a large multilingual search page without losing visible targets or mutating execution data', () => {
    const large: PageSnapshot = {
      ...page,
      text: '模拟搜索结果正文'.repeat(700),
      scrollDown: true,
      targets: Array.from({ length: 200 }, (_, i) => ({
        ref: `e${i}`, name: `视频 ${i}：${'商业模式与企业经营'.repeat(16)}`, role: 'a',
        value: '', checked: null, expanded: null, operations: ['click'],
        requiresScroll: i < 190,
        href: `https://example.test/video/${i}?tracking=${'abcdefgh12345678'.repeat(100)}`,
        linkTarget: '_blank',
      })),
    };
    const history: PageStep[] = Array.from({ length: 20 }, (_, i) => ({
      step: i, proposed: 'click_e1', description: '旧链接信息'.repeat(500),
      executed: true, outcome: 'page changed', confidence: 1, goalDone: 0, stuck: 0, elapsedMs: 1,
    }));
    const before = structuredClone(large);
    const body = decisionRequest('打开当前可见的视频', large, buildActions(large), history);
    expect(Buffer.byteLength(JSON.stringify(body), 'utf8')).toBeLessThanOrEqual(28_000);
    expect(body.state.goal).toBe('打开当前可见的视频');
    expect(body.state.candidatesTruncated).toBe(true);
    expect(body.state.recentActions).toHaveLength(10);
    expect(body.questions.action.criteria).toHaveProperty('click_e199');
    expect(body.questions.action.criteria).toHaveProperty('scroll_down');
    expect(body.questions.action.criteria).toHaveProperty('unsupported');
    for (const target of body.state.elements) {
      expect(body.questions.action.criteria).toHaveProperty(`click_${target.ref}`);
    }
    expect(large).toEqual(before);
  });

  it('rejects a goal that cannot fit before sending anything to the provider', async () => {
    const fetcher = vi.fn<Parameters<typeof fetch>, ReturnType<typeof fetch>>();
    await expect(createJevDecision('test-key', fetcher)(
      '大'.repeat(12_000), page, [], [], new AbortController().signal,
    )).rejects.toMatchObject({ code: 'jev_request_too_large' });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('preserves a provider error code and request ID without echoing secrets or page content', async () => {
    const fetcher = vi.fn<Parameters<typeof fetch>, ReturnType<typeof fetch>>().mockResolvedValue(new Response(
      JSON.stringify({ detail: { error_type: 'max_tokens_exceeded', message: 'private-test-key private page text' } }),
      { status: 400, headers: { 'x-request-id': 'req-123' } },
    ));
    const error = await createJevDecision('private-test-key', fetcher)(
      'Read', page, [], [], new AbortController().signal,
    ).catch(error => error);
    expect(error).toMatchObject({ code: 'jev_max_tokens_exceeded' });
    expect(error.message).toContain('max_tokens_exceeded');
    expect(error.message).toContain('req-123');
    expect(error.message).not.toContain('private-test-key');
    expect(error.message).not.toContain('private page text');
  });

  it('bounds error-body reads and ignores arbitrary HTML or reflected request contents', async () => {
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) { controller.enqueue(new TextEncoder().encode('private-test-key'.repeat(1_000))); },
      cancel() { cancelled = true; },
    });
    const fetcher = vi.fn<Parameters<typeof fetch>, ReturnType<typeof fetch>>().mockResolvedValue(new Response(stream, { status: 500 }));
    const error = await createJevDecision('private-test-key', fetcher)(
      'Read', page, [], [], new AbortController().signal,
    ).catch(error => error);
    expect(error.message).toContain('HTTP 500');
    expect(error.message).not.toContain('private-test-key');
    expect(cancelled).toBe(true);
  });
});

it('offers a named missing-field exit and keeps scroll regions within the same request budget', () => {
  const snapshot: PageSnapshot = { ...page, scrollAreas: [{ ref: 'e2', name: '正文', role: 'main',
    top: 0, height: 500, width: 800, scrollHeight: 2_000, atTop: true, atBottom: false }],
    targets: [{ ref: 'e1', name: 'Email', role: 'textbox', value: '', checked: null, expanded: null, operations: ['fill'] }],
  };
  const body = decisionRequest('Read the document', snapshot, buildActions(snapshot), []);
  expect(body.questions.action.criteria).toHaveProperty('needs_input_e1');
  expect(body.questions.action.criteria).not.toHaveProperty('needs_input');
  expect(body.questions.action.criteria).toHaveProperty('unsupported');
  expect(body.questions.action.criteria).toHaveProperty('scroll_down_e2');
  expect(body.state.scrollAreas[0].name).toBe('正文');
  expect(Buffer.byteLength(JSON.stringify(body))).toBeLessThanOrEqual(28_000);
});
