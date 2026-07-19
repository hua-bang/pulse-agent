import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { CapabilityRuntime } from './runtime';
import type { CapabilityDefinition } from './types';

const echoCapability: CapabilityDefinition<{ text: string }, { echoed: string }> = {
  name: 'test.echo',
  description: 'Echo validated text.',
  risk: 'read',
  inputSchema: z.object({ text: z.string().min(1) }),
  execute: async (input) => ({ echoed: input.text }),
};

describe('CapabilityRuntime', () => {
  it('lists capability metadata without exposing implementation details', () => {
    const runtime = new CapabilityRuntime([echoCapability]);

    expect(runtime.list({ kind: 'test' })).toEqual([
      {
        name: 'test.echo',
        description: 'Echo validated text.',
        risk: 'read',
        inputSchema: expect.objectContaining({ type: 'object' }),
      },
    ]);
  });

  it('applies the same actor policy to discovery and execution', async () => {
    const unsafeCapability: CapabilityDefinition<Record<string, never>, { reached: true }> = {
      ...echoCapability,
      name: 'test.unsafe',
      risk: 'unsafe',
      inputSchema: z.object({}),
      execute: async () => ({ reached: true }),
    };
    const runtime = new CapabilityRuntime(
      [echoCapability, unsafeCapability],
      (capability, actor) => actor.kind !== 'pulse-cli' || capability.risk !== 'unsafe',
    );

    expect(runtime.list({ kind: 'pulse-cli' }).map(({ name }) => name)).toEqual(['test.echo']);
    await expect(runtime.call(
      'test.unsafe',
      {},
      { workspaceId: 'ws-1', actor: { kind: 'pulse-cli' } },
    )).resolves.toEqual({
      ok: false,
      error: {
        code: 'capability_forbidden',
        message: 'Actor pulse-cli cannot call capability test.unsafe',
      },
    });
  });

  it('validates input and returns a structured execution result', async () => {
    const runtime = new CapabilityRuntime([echoCapability]);
    const context = { workspaceId: 'ws-1', actor: { kind: 'test' as const } };

    await expect(runtime.call('test.echo', { text: 'hello' }, context)).resolves.toEqual({
      ok: true,
      value: { echoed: 'hello' },
    });

    const invalid = await runtime.call('test.echo', { text: '' }, context);
    expect(invalid).toMatchObject({
      ok: false,
      error: { code: 'invalid_input', message: expect.stringContaining('text') },
    });
  });

  it('rejects unknown capabilities and missing workspace context', async () => {
    const runtime = new CapabilityRuntime([echoCapability]);

    await expect(runtime.call(
      'test.missing',
      {},
      { workspaceId: 'ws-1', actor: { kind: 'test' } },
    )).resolves.toEqual({
      ok: false,
      error: { code: 'capability_not_found', message: 'Unknown capability: test.missing' },
    });

    const missingWorkspace = await runtime.call(
      'test.echo',
      { text: 'hello' },
      { workspaceId: '', actor: { kind: 'test' } },
    );
    expect(missingWorkspace).toEqual({
      ok: false,
      error: { code: 'invalid_context', message: 'workspaceId is required' },
    });
  });
});
