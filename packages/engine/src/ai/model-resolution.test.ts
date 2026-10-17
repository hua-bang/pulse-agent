import { describe, expect, it, vi } from 'vitest';
import { MockLanguageModelV3 } from 'ai/test';

import { generateTextAI, summarizeMessages } from './index.js';
import { DEFAULT_MODEL } from '../config/index.js';

const usage = {
  inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 1, text: 1, reasoning: 0 },
};

function textModel(text = 'ok') {
  return new MockLanguageModelV3({
    doGenerate: async () => ({
      content: [{ type: 'text', text }],
      finishReason: { unified: 'stop', raw: 'stop' },
      usage,
      warnings: [],
    }),
  });
}

describe('summary model resolution', () => {
  it('falls back to DEFAULT_MODEL, not an empty name, when no model is given', async () => {
    const model = textModel();
    const provider = vi.fn(() => model);

    await summarizeMessages([{ role: 'user', content: 'hi' }], { provider });

    expect(provider).toHaveBeenCalledWith(DEFAULT_MODEL);
    expect(DEFAULT_MODEL).not.toBe('');
  });

  it('summarizes with the run model when no override is configured', async () => {
    const model = textModel();
    const provider = vi.fn(() => model);

    await summarizeMessages([{ role: 'user', content: 'hi' }], { provider, model: 'run-model' });

    expect(provider).toHaveBeenCalledWith('run-model');
  });
});

describe('generateTextAI request shaping', () => {
  it('sets an explicit output cap so providers never fall back to 4096', async () => {
    const model = textModel();

    await generateTextAI([{ role: 'user', content: 'plan' }], {}, { provider: () => model });

    expect(model.doGenerateCalls[0].maxOutputTokens).toBe(16384);
  });

  it('applies the Claude output cap when modelType is claude', async () => {
    const model = textModel();

    await generateTextAI([{ role: 'user', content: 'plan' }], {}, { provider: () => model, modelType: 'claude' });

    expect(model.doGenerateCalls[0].maxOutputTokens).toBe(32768);
  });
});
