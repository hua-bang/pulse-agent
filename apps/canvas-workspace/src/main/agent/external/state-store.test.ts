import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { clearExternalSessionId, getExternalSessionId, saveExternalSessionId } from './state-store';

let directory: string;
let previous: string | undefined;
const role = (id: string) => ({ id, external: { family: 'claude-code' as const, cwd: '/work' } });

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'external-agent-state-'));
  previous = process.env.PULSE_CANVAS_EXTERNAL_AGENT_STATE;
  process.env.PULSE_CANVAS_EXTERNAL_AGENT_STATE = join(directory, 'external-agent-state.json');
});
afterEach(async () => {
  if (previous === undefined) delete process.env.PULSE_CANVAS_EXTERNAL_AGENT_STATE;
  else process.env.PULSE_CANVAS_EXTERNAL_AGENT_STATE = previous;
  await rm(directory, { recursive: true, force: true });
});

it('keeps every role session id when roles save concurrently', async () => {
  const ids = Array.from({ length: 12 }, (_, index) => `role-${index}`);
  await Promise.all(ids.map(id => saveExternalSessionId('chat', role(id), `session-${id}`)));
  for (const id of ids) expect(await getExternalSessionId('chat', role(id))).toBe(`session-${id}`);
  expect(await readdir(directory)).toEqual(['external-agent-state.json']);
});

it('applies concurrent clears and saves in order without losing unrelated entries', async () => {
  await saveExternalSessionId('chat', role('kept'), 'kept-session');
  await saveExternalSessionId('chat', role('cleared'), 'old-session');
  await Promise.all([
    clearExternalSessionId('chat', 'cleared'),
    saveExternalSessionId('chat', role('added'), 'added-session'),
  ]);
  expect(await getExternalSessionId('chat', role('kept'))).toBe('kept-session');
  expect(await getExternalSessionId('chat', role('cleared'))).toBeUndefined();
  expect(await getExternalSessionId('chat', role('added'))).toBe('added-session');
});
