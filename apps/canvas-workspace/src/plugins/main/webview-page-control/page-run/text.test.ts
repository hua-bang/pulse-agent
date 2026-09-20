import { afterEach, describe, expect, it, vi } from 'vitest';
const generate = vi.hoisted(() => vi.fn());
vi.mock('ai', () => ({ generateText: generate }));
vi.mock('../../../../main/models/config', () => ({
  resolveCanvasModel: async () => ({ model: 'configured-model', provider: (name: string) => name }),
}));
import { generateFieldText, parseFieldText } from './text';
import type { PageSnapshot, PageTarget } from './types';
const target: PageTarget = { ref: 'e1', name: '目的地', role: 'textbox', value: '', checked: null, expanded: null, operations: ['fill'] };
const page: PageSnapshot = { id: 's', documentId: 'd', url: 'https://example.test', title: 'Search', text: '', fingerprint: 'f', targets: [target], truncated: false, scrollUp: false, scrollDown: false };
afterEach(() => { generate.mockReset(); });

describe('browser field generation', () => {
  it('reuses the configured Canvas model and preserves Chinese input', async () => {
    generate.mockResolvedValue({ text: '{"text":"苏黎世"}', finishReason: 'stop' });
    expect(await generateFieldText('搜索苏黎世', target, page, new AbortController().signal)).toBe('苏黎世');
    expect(generate).toHaveBeenCalledWith(expect.objectContaining({ model: 'configured-model', maxRetries: 0, abortSignal: expect.any(AbortSignal) }));
  });

  it.each(['{"text":null}', '{"text":""}', '解释：苏黎世', '{"text":"Zurich","code":"click()"}'])('returns control rather than typing invalid output %s', raw => {
    expect(() => parseFieldText(raw)).toThrow('valid field value');
  });

  it('does not guess on a provider failure', async () => {
    generate.mockRejectedValue(new Error('provider failed'));
    await expect(generateFieldText('搜索苏黎世', target, page, new AbortController().signal))
      .rejects.toMatchObject({ status: 'error', code: 'field_generation_failed' });
    expect(generate).toHaveBeenCalledTimes(1);
  });
});

it('names the missing field when the text model explicitly returns null', async () => {
  generate.mockResolvedValue({ text: '{"text":null}', finishReason: 'stop' });
  const error = await generateFieldText('Search', target, page, new AbortController().signal).catch(error => error);
  expect(error).toMatchObject({ status: 'needs_input', code: 'missing_field_value' });
  expect(error.message).toContain('目的地');
});
