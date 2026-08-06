import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { loadModelRegistry, parseModelSpec, shortModelLabel } from './model-registry.js';

describe('parseModelSpec', () => {
  it('pins provider from prefixed specs and passes bare ids through', () => {
    expect(parseModelSpec('claude:claude-opus-5')).toEqual({ model: 'claude-opus-5', modelType: 'claude' });
    expect(parseModelSpec('openai:gpt-5.2')).toEqual({ model: 'gpt-5.2', modelType: 'openai' });
    expect(parseModelSpec('novita/deepseek/deepseek_v3')).toEqual({ model: 'novita/deepseek/deepseek_v3' });
    expect(parseModelSpec('  ')).toBeNull();
    expect(parseModelSpec('claude:')).toBeNull();
  });
});

describe('shortModelLabel', () => {
  it('keeps the last path segment and truncates long ids', () => {
    expect(shortModelLabel('novita/deepseek/deepseek_v3')).toBe('deepseek_v3');
    expect(shortModelLabel('gpt-5.2')).toBe('gpt-5.2');
    expect(shortModelLabel('a-very-long-model-identifier-name', 10)).toBe('a-very-lo…');
  });
});

describe('loadModelRegistry', () => {
  let cwd: string;

  beforeEach(async () => {
    cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'pulse-models-'));
  });

  afterEach(async () => {
    await fs.rm(cwd, { recursive: true, force: true });
  });

  it('returns empty when no registry file exists', async () => {
    expect(await loadModelRegistry(cwd)).toEqual([]);
  });

  it('reads array and object shapes with string and object entries', async () => {
    await fs.mkdir(path.join(cwd, '.pulse-coder'), { recursive: true });
    await fs.writeFile(path.join(cwd, '.pulse-coder', 'models.json'), JSON.stringify({
      models: [
        'openai:deepseek-v4-flash',
        { model: 'claude-opus-5', type: 'claude', label: 'Opus 5', contextWindow: 200000 },
        { model: 'kimi-k3', context_window: 262144.9 },
        { model: 'bad-window', contextWindow: -1 },
        { model: '   ' },
        42,
      ],
    }));

    expect(await loadModelRegistry(cwd)).toEqual([
      { model: 'deepseek-v4-flash', modelType: 'openai' },
      { model: 'claude-opus-5', modelType: 'claude', label: 'Opus 5', contextWindow: 200000 },
      { model: 'kimi-k3', contextWindow: 262144 },
      { model: 'bad-window' },
    ]);
  });
});
