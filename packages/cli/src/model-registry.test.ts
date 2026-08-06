import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { loadModelRegistry, parseModelSpec, resolveModelSpec, shortModelLabel, type ModelRegistry } from './model-registry.js';

describe('parseModelSpec', () => {
  it('pins the SDK channel from prefixed specs and passes bare ids through', () => {
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

  const write = async (content: unknown) => {
    await fs.mkdir(path.join(cwd, '.pulse-coder'), { recursive: true });
    await fs.writeFile(path.join(cwd, '.pulse-coder', 'models.json'), JSON.stringify(content));
  };

  it('returns an empty registry when no file exists', async () => {
    expect(await loadModelRegistry(cwd)).toEqual({ providers: {}, models: [], warnings: [] });
  });

  it('resolves provider references onto model entries', async () => {
    await write({
      providers: {
        deepseek: { type: 'openai', baseUrl: 'https://api.deepseek.com/v1', apiKeyEnv: 'DEEPSEEK_API_KEY' },
        anthropic: { type: 'claude' },
      },
      models: [
        { model: 'deepseek-v4-flash', provider: 'deepseek', contextWindow: 128000 },
        { model: 'claude-opus-5', provider: 'anthropic', label: 'Opus 5' },
        'deepseek:deepseek-r2',
        'openai:gpt-5.2',
      ],
    });

    const registry = await loadModelRegistry(cwd);
    expect(registry.warnings).toEqual([]);
    expect(registry.models).toEqual([
      {
        model: 'deepseek-v4-flash',
        modelType: 'openai',
        providerName: 'deepseek',
        baseUrl: 'https://api.deepseek.com/v1',
        apiKeyEnv: 'DEEPSEEK_API_KEY',
        contextWindow: 128000,
      },
      { model: 'claude-opus-5', modelType: 'claude', providerName: 'anthropic', label: 'Opus 5' },
      {
        model: 'deepseek-r2',
        modelType: 'openai',
        providerName: 'deepseek',
        baseUrl: 'https://api.deepseek.com/v1',
        apiKeyEnv: 'DEEPSEEK_API_KEY',
      },
      { model: 'gpt-5.2', modelType: 'openai' },
    ]);
  });

  it('warns on unknown providers and inline api keys, never storing the key', async () => {
    await write({
      providers: { leaky: { type: 'openai', apiKey: 'sk-secret', apiKeyEnv: 'LEAKY_KEY' } },
      models: [{ model: 'mystery', provider: 'ghost' }],
    });

    const registry = await loadModelRegistry(cwd);
    expect(registry.warnings.some(warning => warning.includes('inline apiKey ignored'))).toBe(true);
    expect(registry.warnings.some(warning => warning.includes('unknown provider "ghost"'))).toBe(true);
    expect(JSON.stringify(registry.providers)).not.toContain('sk-secret');
    expect(registry.models).toEqual([{ model: 'mystery' }]);
  });
});

describe('resolveModelSpec', () => {
  const registry: ModelRegistry = {
    providers: {
      deepseek: { name: 'deepseek', type: 'openai', baseUrl: 'https://api.deepseek.com/v1', apiKeyEnv: 'DEEPSEEK_API_KEY' },
    },
    models: [
      { model: 'deepseek-v4-flash', modelType: 'openai', providerName: 'deepseek', baseUrl: 'https://api.deepseek.com/v1', apiKeyEnv: 'DEEPSEEK_API_KEY', contextWindow: 128000 },
    ],
    warnings: [],
  };

  it('prefers exact registry matches (with full connection + window)', () => {
    expect(resolveModelSpec('deepseek-v4-flash', registry)?.contextWindow).toBe(128000);
    expect(resolveModelSpec('deepseek:deepseek-v4-flash', registry)?.contextWindow).toBe(128000);
  });

  it('resolves provider prefixes for ad-hoc models and falls back to channel prefixes', () => {
    expect(resolveModelSpec('deepseek:deepseek-r2', registry)).toMatchObject({
      model: 'deepseek-r2',
      providerName: 'deepseek',
      baseUrl: 'https://api.deepseek.com/v1',
    });
    expect(resolveModelSpec('claude:claude-opus-5', registry)).toEqual({ model: 'claude-opus-5', modelType: 'claude' });
    expect(resolveModelSpec('bare-model', registry)).toEqual({ model: 'bare-model' });
  });
});
