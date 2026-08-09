import { describe, expect, it, vi } from 'vitest';

import { InkCoderController } from './ink-controller.js';
import type { InputManager } from './input-manager.js';

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

/**
 * The clarification prompt renders "Default: <x>" from the request's
 * `defaultAnswer`. Submitting an empty draft used to hand the engine the empty
 * string anyway, so the advertised default was decoration: the engine saw no
 * answer, and the transcript showed "(empty clarification response)".
 */
describe('clarification defaults', () => {
  const buildController = () => {
    const controller = new InkCoderController();
    return controller as unknown as {
      inputManager: InputManager;
      submitInput: (input: string) => Promise<void>;
      ui: { events: TranscriptEvent[] };
    };
  };

  it('sends the advertised default when the answer is empty', async () => {
    const internals = buildController();

    const answer = internals.inputManager.requestInput({
      id: 'clarify-1',
      question: 'Run the migration now?',
      defaultAnswer: 'yes',
      timeout: 0,
    });

    await internals.submitInput('   ');

    // What the engine receives…
    await expect(answer).resolves.toBe('yes');
    // …and what the user is shown are the same string.
    const echoed = internals.ui.events.filter(event => event.kind === 'user');
    expect(echoed.map(event => event.text)).toEqual(['yes']);
    expect(internals.inputManager.hasPendingRequest()).toBe(false);
  });

  it('keeps a typed answer and an empty answer with no default unchanged', async () => {
    const typed = buildController();
    const typedAnswer = typed.inputManager.requestInput({
      id: 'clarify-2',
      question: 'Which branch?',
      defaultAnswer: 'main',
      timeout: 0,
    });
    await typed.submitInput('  release  ');
    await expect(typedAnswer).resolves.toBe('release');

    const bare = buildController();
    const bareAnswer = bare.inputManager.requestInput({
      id: 'clarify-3',
      question: 'Which branch?',
      timeout: 0,
    });
    await bare.submitInput('');
    await expect(bareAnswer).resolves.toBe('');
    expect(bare.ui.events.filter(event => event.kind === 'user').map(event => event.text))
      .toEqual(['(empty clarification response)']);
  });
});
