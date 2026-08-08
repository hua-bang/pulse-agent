import { describe, expect, it, vi } from 'vitest';

import { InkCoderController } from './ink-controller.js';

interface TranscriptEvent {
  kind: string;
  title?: string;
  text: string;
}

/**
 * Guard for a real failure: `pulse-coder-engine`'s `loop()` does NOT throw on
 * abort — once the signal fires it returns the plain sentinel string
 * `'Request aborted.'` as an ordinary result. The controller's `AbortError`
 * catch therefore never sees an engine-side cancellation, and before this guard
 * the success path ran anyway: the partial answer was finalized as final, a
 * "Done in Xs" summary was written, the sentinel was printed as the model's
 * reply, and the cancelled turn was saved to the session and the daily log.
 */
describe('runMessage cancellation', () => {
  const buildController = (runImpl: (context: unknown, options: any) => Promise<string>) => {
    const controller = new InkCoderController();
    const internals = controller as unknown as {
      agent: { run: unknown };
      sessionCommands: {
        saveContext: unknown;
        getCurrentSessionId: () => string | null;
        getCurrentTaskListId: () => string | null;
      };
      syncSessionTaskListBinding: () => Promise<void>;
      resolveCurrentSessionId: () => string | null;
      runMessage: (input: string) => Promise<void>;
      requestStop: () => void;
      ui: { events: TranscriptEvent[] };
    };

    const saveContext = vi.fn(async () => {});
    internals.agent.run = vi.fn(runImpl);
    internals.sessionCommands.saveContext = saveContext;
    // A null session id keeps the run off the memory-context and daily-log paths.
    internals.resolveCurrentSessionId = () => null;
    internals.sessionCommands.getCurrentSessionId = () => null;
    internals.sessionCommands.getCurrentTaskListId = () => null;
    internals.syncSessionTaskListBinding = async () => {};

    return { internals, saveContext };
  };

  it('does not report an aborted run as a completed answer', async () => {
    const { internals, saveContext } = buildController(async () => {
      // Mirror the engine: cancel mid-run, then resolve with the sentinel string
      // rather than throwing.
      internals.requestStop();
      return 'Request aborted.';
    });

    await internals.runMessage('do the thing');

    const events = internals.ui.events;

    // The sentinel must never reach the transcript as an assistant answer.
    expect(events.filter(event => event.kind === 'assistant')).toEqual([]);
    expect(events.some(event => event.text.includes('Request aborted.'))).toBe(false);
    // The cancellation is what the user sees instead.
    expect(events.some(event => event.kind === 'error' && event.title === 'Abort')).toBe(true);
    // A cancelled turn is not persisted.
    expect(saveContext).not.toHaveBeenCalled();
  });

  it('still reports a normal run as a completed answer', async () => {
    const { internals, saveContext } = buildController(async () => 'the real answer');

    await internals.runMessage('do the thing');

    expect(internals.ui.events.some(event => event.kind === 'assistant' && event.text.includes('the real answer'))).toBe(true);
    expect(internals.ui.events.some(event => event.kind === 'error' && event.title === 'Abort')).toBe(false);
    expect(saveContext).toHaveBeenCalled();
  });
});
