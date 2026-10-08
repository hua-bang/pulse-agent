import { expect, it, vi } from 'vitest';
import { z } from 'zod';

const flag = vi.hoisted(() => vi.fn());
vi.mock('../../settings/experimental-ipc', () => ({ getExperimentalFlagSync: flag }));
vi.mock('./tab-capabilities', () => ({ createTabCapabilities: () => [] }));
vi.mock('./page-capabilities', () => ({ createPageCapabilities: () => [] }));
vi.mock('./node-capabilities', () => ({ createNodeCapabilities: () => [] }));
import { getCanvasCapabilityRuntime } from './index';

it('allows saved-log queries but denies opening the in-app UI when its route is disabled', async () => {
  const runtime = getCanvasCapabilityRuntime();
  const query = vi.fn().mockResolvedValue({ runs: [] });
  const open = vi.fn().mockResolvedValue({ opened: true });
  runtime.register({
    name: 'devtools.logs.query', description: 'Saved traces', risk: 'read',
    inputSchema: z.object({}), execute: query,
  });
  runtime.register({
    name: 'devtools.logs.open', description: 'In-app viewer', risk: 'operate',
    inputSchema: z.object({}), execute: open,
  });
  const actor = { kind: 'pulse-cli' as const };
  const context = { workspaceId: 'ws-1', actor };
  flag.mockReturnValue(false);
  expect(runtime.list(actor).map(value => value.name)).toEqual(['devtools.logs.query']);
  expect(await runtime.call('devtools.logs.query', {}, context)).toEqual({ ok: true, value: { runs: [] } });
  expect(await runtime.call('devtools.logs.open', {}, context))
    .toMatchObject({ ok: false, error: { code: 'capability_forbidden' } });
  expect(open).not.toHaveBeenCalled();
  flag.mockImplementation(id => id === 'canvas-agent-debug-trace');
  expect(runtime.list(actor).map(value => value.name)).toEqual(['devtools.logs.query', 'devtools.logs.open']);
  expect(await runtime.call('devtools.logs.open', {}, context)).toEqual({ ok: true, value: { opened: true } });
});
