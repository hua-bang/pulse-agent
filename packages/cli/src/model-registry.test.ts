import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { findDefaultModel, formatModelSpec, loadModelRegistry, parseModelSpec, resolveKnownModelSpec, resolveModelSpec, shortModelLabel, type ModelRegistry } from './model-registry.js';

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
  let home: string;

  beforeEach(async () => {
    cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'pulse-models-'));
    home = await fs.mkdtemp(path.join(os.tmpdir(), 'pulse-home-'));
  });

  afterEach(async () => {
    await fs.rm(cwd, { recursive: true, force: true });
    await fs.rm(home, { recursive: true, force: true });
  });

  const writeAt = async (root: string, content: unknown, dir = '.pulse-coder') => {
    await fs.mkdir(path.join(root, dir), { recursive: true });
    await fs.writeFile(path.join(root, dir, 'models.json'), JSON.stringify(content));
  };
  const write = async (content: unknown) => writeAt(cwd, content);

  it('returns an empty registry when no file exists', async () => {
    expect(await loadModelRegistry(cwd, home)).toEqual({ providers: {}, models: [], warnings: [] });
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

    const registry = await loadModelRegistry(cwd, home);
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

  it('carries the provider promptCacheKey opt-in onto its models only', async () => {
    await write({
      providers: {
        sub2api: { type: 'openai', baseUrl: 'https://sub2.example/v1', apiKeyEnv: 'SUB2_KEY', promptCacheKey: true },
        deepseek: { type: 'openai', baseUrl: 'https://api.deepseek.com/v1', apiKeyEnv: 'DEEPSEEK_API_KEY' },
      },
      models: [
        { model: 'gpt-test', provider: 'sub2api' },
        { model: 'deepseek-v4-flash', provider: 'deepseek' },
      ],
    });

    const registry = await loadModelRegistry(cwd, home);
    expect(registry.models[0].promptCacheKey).toBe(true);
    // Not opted in → the field is absent, not false, so spreads stay clean.
    expect('promptCacheKey' in registry.models[1]).toBe(false);
  });

  it('drops a stale home opt-in when the project redefines the provider without it', async () => {
    await writeAt(home, {
      providers: { acme: { type: 'openai', baseUrl: 'https://home.example/v1', promptCacheKey: true } },
      models: [{ model: 'shared-model', provider: 'acme' }],
    });
    await write({
      providers: { acme: { type: 'openai', baseUrl: 'https://project.example/v1' } },
      models: [],
    });

    const registry = await loadModelRegistry(cwd, home);
    const rebased = registry.models.find(choice => choice.model === 'shared-model');
    // The project provider is the SSOT: connection rebased, opt-in gone.
    expect(rebased?.baseUrl).toBe('https://project.example/v1');
    expect(rebased?.promptCacheKey).toBeUndefined();
  });

  it('parses the default flag on a model entry', async () => {
    await write({ models: [{ model: 'a' }, { model: 'b', default: true }] });
    const registry = await loadModelRegistry(cwd, home);
    expect(registry.models.map(choice => choice.isDefault)).toEqual([undefined, true]);
    expect(findDefaultModel(registry)?.model).toBe('b');
  });

  it('warns on unknown providers and inline api keys, never storing the key', async () => {
    await write({
      providers: { leaky: { type: 'openai', apiKey: 'sk-secret', apiKeyEnv: 'LEAKY_KEY' } },
      models: [{ model: 'mystery', provider: 'ghost' }],
    });

    const registry = await loadModelRegistry(cwd, home);
    expect(registry.warnings.some(warning => warning.includes('inline apiKey ignored'))).toBe(true);
    expect(registry.warnings.some(warning => warning.includes('unknown provider "ghost"'))).toBe(true);
    expect(JSON.stringify(registry.providers)).not.toContain('sk-secret');
    expect(registry.models).toEqual([{ model: 'mystery' }]);
  });

  it('reads the home registry when the project has none', async () => {
    await writeAt(home, {
      providers: { deepseek: { type: 'openai', baseUrl: 'https://api.deepseek.com/v1' } },
      models: [{ model: 'deepseek-v4-flash', provider: 'deepseek', contextWindow: 128000 }],
    });

    const registry = await loadModelRegistry(cwd, home);
    expect(registry.models).toEqual([{
      model: 'deepseek-v4-flash',
      modelType: 'openai',
      providerName: 'deepseek',
      baseUrl: 'https://api.deepseek.com/v1',
      contextWindow: 128000,
    }]);
  });

  it('merges home and project, letting project win on the same id and appending its extras', async () => {
    await writeAt(home, {
      providers: { deepseek: { type: 'openai', baseUrl: 'https://home.example/v1' } },
      models: [
        { model: 'deepseek-v4-flash', provider: 'deepseek', contextWindow: 128000 },
        { model: 'shared-only-home', provider: 'deepseek' },
      ],
    });
    await write({
      providers: { deepseek: { type: 'openai', baseUrl: 'https://project.example/v1' } },
      models: [
        { model: 'deepseek-v4-flash', provider: 'deepseek', contextWindow: 256000, label: 'Project pin' },
        { model: 'project-only', provider: 'deepseek' },
      ],
    });

    const registry = await loadModelRegistry(cwd, home);
    // Project provider connection wins, and home-only models are rebased onto it.
    expect(registry.providers.deepseek.baseUrl).toBe('https://project.example/v1');
    expect(registry.models.map(choice => `${choice.model}@${choice.baseUrl}`)).toEqual([
      'shared-only-home@https://project.example/v1',
      'deepseek-v4-flash@https://project.example/v1',
      'project-only@https://project.example/v1',
    ]);
    const pinned = registry.models.find(choice => choice.model === 'deepseek-v4-flash');
    expect(pinned).toMatchObject({ contextWindow: 256000, label: 'Project pin' });
  });

  it('reports an unreadable registry instead of throwing', async () => {
    await fs.mkdir(path.join(cwd, '.pulse-coder'), { recursive: true });
    await fs.writeFile(path.join(cwd, '.pulse-coder', 'models.json'), '{ not json');

    const registry = await loadModelRegistry(cwd, home);
    expect(registry.models).toEqual([]);
    expect(registry.warnings.some(warning => warning.includes('unreadable or invalid JSON'))).toBe(true);
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

describe('resolveKnownModelSpec', () => {
  const registry: ModelRegistry = {
    providers: { deepseek: { name: 'deepseek', type: 'openai', baseUrl: 'https://api.deepseek.com/v1' } },
    models: [{ model: 'v4', modelType: 'openai', providerName: 'deepseek', baseUrl: 'https://api.deepseek.com/v1' }],
    warnings: [],
  };

  it('rejects a spec whose provider is no longer defined', () => {
    // resolveModelSpec would hand back the literal id 'acme:foo' instead.
    expect(resolveModelSpec('acme:foo', registry)).toEqual({ model: 'acme:foo' });
    expect(resolveKnownModelSpec('acme:foo', registry)).toBeNull();
  });

  it('accepts registry entries, live providers, SDK channels and bare ids', () => {
    expect(resolveKnownModelSpec('deepseek:v4', registry)).toEqual(registry.models[0]);
    expect(resolveKnownModelSpec('deepseek:ad-hoc', registry)).toMatchObject({ model: 'ad-hoc', providerName: 'deepseek' });
    expect(resolveKnownModelSpec('claude:claude-opus-5', registry)).toEqual({ model: 'claude-opus-5', modelType: 'claude' });
    expect(resolveKnownModelSpec('novita/deepseek/deepseek_v3', registry)).toEqual({ model: 'novita/deepseek/deepseek_v3' });
    expect(resolveKnownModelSpec('  ', registry)).toBeNull();
  });
});

describe('findDefaultModel / formatModelSpec', () => {
  it('finds the entry marked default and returns null when none is', () => {
    const withDefault: ModelRegistry = {
      providers: {},
      models: [
        { model: 'a' },
        { model: 'b', isDefault: true },
        { model: 'c', isDefault: true },
      ],
      warnings: [],
    };
    expect(findDefaultModel(withDefault)?.model).toBe('b');
    expect(findDefaultModel({ providers: {}, models: [{ model: 'a' }], warnings: [] })).toBeNull();
  });

  it('formats a round-trippable spec, preferring the provider name', () => {
    expect(formatModelSpec({ model: 'x', providerName: 'deepseek', modelType: 'openai' })).toBe('deepseek:x');
    expect(formatModelSpec({ model: 'x', modelType: 'claude' })).toBe('claude:x');
    expect(formatModelSpec({ model: 'x' })).toBe('x');
  });

  it('round-trips a registry entry through formatModelSpec + resolveModelSpec', () => {
    const registry: ModelRegistry = {
      providers: { deepseek: { name: 'deepseek', type: 'openai', baseUrl: 'https://api.deepseek.com/v1' } },
      models: [{ model: 'v4', providerName: 'deepseek', modelType: 'openai', baseUrl: 'https://api.deepseek.com/v1', contextWindow: 128000 }],
      warnings: [],
    };
    const spec = formatModelSpec(registry.models[0]);
    expect(resolveModelSpec(spec, registry)).toEqual(registry.models[0]);
  });
});
