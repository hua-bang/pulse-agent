import type { ModelMessage } from 'ai';
import { afterEach, describe, expect, it } from 'vitest';
import type { CanvasAgentMessage, CanvasAgentSession } from '../types';
import { resetCompactionCheckpointsForTests } from './compaction-checkpoint';
import { prepareRunSession } from './run-session-context';

const turn = (index: number): CanvasAgentMessage[] => [
  { role: 'user', content: `ask ${index}`, timestamp: index * 10 },
  { role: 'assistant', content: `answer ${index}`, timestamp: index * 10 + 1 },
];

const summary = (text: string): ModelMessage => ({ role: 'assistant', content: text });

async function startTurn(session: CanvasAgentSession, ask: string) {
  const run = await prepareRunSession({
    getCurrentSession: () => session,
    readSession: async () => session,
    appendToSession: async () => undefined,
  }, session.sessionId, (_id, messages) => { session.messages.push(...messages); });
  if (!run.ok) throw new Error('Session missing');
  run.runMessages.push({ role: 'user', content: ask });
  run.appendRunMessages([{ role: 'user', content: ask, timestamp: Date.now() }]);
  return run;
}

const contents = (messages: ModelMessage[]) => messages.map(message => message.content);

afterEach(() => resetCompactionCheckpointsForTests());

describe('compaction checkpoints', () => {
  it('reuses a compaction on the next turn instead of replaying covered history', async () => {
    const session: CanvasAgentSession = {
      sessionId: 's1', workspaceId: 'ws', startedAt: '', messages: [...turn(1), ...turn(2), ...turn(3)],
    };
    const first = await startTurn(session, 'ask 4');
    // Summarize turns 1-2, keep turn 3 and the new ask.
    first.replaceRunMessages([summary('S1'), ...first.runMessages.slice(4)]);
    expect(contents(first.runMessages)).toEqual(['S1', 'ask 3', 'answer 3', 'ask 4']);
    session.messages.push({ role: 'assistant', content: 'answer 4', timestamp: 41 });

    const second = await startTurn(session, 'ask 5');
    expect(contents(second.runMessages)).toEqual(['S1', 'ask 3', 'answer 3', 'ask 4', 'answer 4', 'ask 5']);
  });

  it('never covers the current ask when the compaction keeps it', async () => {
    const session: CanvasAgentSession = { sessionId: 's2', workspaceId: 'ws', startedAt: '', messages: turn(1) };
    const first = await startTurn(session, 'ask 2');
    const ask = first.runMessages.at(-1)!;
    first.replaceRunMessages([summary('S1'), ask, { role: 'assistant', content: 'tool frames' }]);
    session.messages.push({ role: 'assistant', content: 'answer 2', timestamp: 21 });

    const second = await startTurn(session, 'ask 3');
    expect(contents(second.runMessages)).toEqual(['S1', 'ask 2', 'answer 2', 'ask 3']);
  });

  it('covers the current ask once it was summarized', async () => {
    const session: CanvasAgentSession = { sessionId: 's3', workspaceId: 'ws', startedAt: '', messages: turn(1) };
    const first = await startTurn(session, 'ask 2');
    first.runMessages.push({ role: 'assistant', content: 'step frames' });
    const frames = first.runMessages.at(-1)!;
    first.replaceRunMessages([summary('S1'), frames, { role: 'user', content: 'Continue.' }]);
    session.messages.push({ role: 'assistant', content: 'answer 2', timestamp: 21 });

    const second = await startTurn(session, 'ask 3');
    expect(contents(second.runMessages)).toEqual(['S1', 'answer 2', 'ask 3']);
  });

  it('drops the checkpoint when covered history is rewritten', async () => {
    const session: CanvasAgentSession = {
      sessionId: 's4', workspaceId: 'ws', startedAt: '', messages: [...turn(1), ...turn(2)],
    };
    const first = await startTurn(session, 'ask 3');
    first.replaceRunMessages([summary('S1'), ...first.runMessages.slice(2)]);
    // Edit the first ask: history is cut and resent from there.
    session.messages = [{ role: 'user', content: 'edited ask', timestamp: 99 }];

    const second = await startTurn(session, 'ask again');
    expect(contents(second.runMessages)).toEqual(['edited ask', 'ask again']);
  });
});
