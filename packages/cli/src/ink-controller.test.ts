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
interface ControllerInternals {
  agent: { run: unknown };
  sessionCommands: {
    saveContext: unknown;
    getCurrentSessionId: () => string | null;
    getCurrentTaskListId: () => string | null;
  };
  syncSessionTaskListBinding: () => Promise<void>;
  resolveCurrentSessionId: () => string | null;
  runMessage: (input: string) => Promise<void>;
  submitInput: (input: string) => Promise<void>;
  queuedInputs: string[];
  requestStop: () => void;
  inputManager: InputManager;
  ui: { events: TranscriptEvent[] };
}

/** A controller whose engine run is a stub and whose session I/O is inert. */
const buildController = (runImpl: (context: unknown, options: any) => Promise<string>) => {
  const controller = new InkCoderController();
  const internals = controller as unknown as ControllerInternals;

  const saveContext = vi.fn(async () => {});
  const run = vi.fn(runImpl);
  internals.agent.run = run;
  internals.sessionCommands.saveContext = saveContext;
  // A null session id keeps the run off the memory-context and daily-log paths.
  internals.resolveCurrentSessionId = () => null;
  internals.sessionCommands.getCurrentSessionId = () => null;
  internals.sessionCommands.getCurrentTaskListId = () => null;
  internals.syncSessionTaskListBinding = async () => {};

  return { internals, saveContext, run };
};

/** Queued input runs on setImmediate, so pinning order means waiting for it. */
const waitUntil = async (predicate: () => boolean, timeoutMs = 3_000): Promise<void> => {
  const deadline = Date.now() + timeoutMs;
  while (!predicate() && Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, 5));
  }
};

describe('runMessage cancellation', () => {
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
  const buildBareController = () => new InkCoderController() as unknown as ControllerInternals;

  it('sends the advertised default when the answer is empty', async () => {
    const internals = buildBareController();

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
    const typed = buildBareController();
    const typedAnswer = typed.inputManager.requestInput({
      id: 'clarify-2',
      question: 'Which branch?',
      defaultAnswer: 'main',
      timeout: 0,
    });
    await typed.submitInput('  release  ');
    await expect(typedAnswer).resolves.toBe('release');

    const bare = buildBareController();
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

/**
 * Input typed during a run is queued and drained when the run ends — but the
 * drain only pulled ONE entry and then relied on whatever ran next to pull the
 * following one. Of the sixteen command cases only `/compact` (via
 * `runExclusive`) did; every other command returned straight to the caller, so
 * a queue like [/status, "continue"] stalled after /status: the status line
 * kept counting an input nobody would run, and the next message the user typed
 * executed BEFORE it.
 */
describe('queued input across slash commands', () => {
  it('keeps draining after a command and preserves the typed order', async () => {
    const { internals, run } = buildController(async () => {
      // Typed while the first run is in flight, so both are queued.
      if ((run.mock.calls.length ?? 0) === 1) {
        await internals.submitInput('/status');
        await internals.submitInput('continue');
      }
      return 'answer';
    });

    await internals.runMessage('first message');
    expect(internals.queuedInputs).toHaveLength(2);

    // The command drains, and the message behind it drains after the command.
    await waitUntil(() => run.mock.calls.length >= 2);

    expect(run).toHaveBeenCalledTimes(2);
    expect(internals.queuedInputs).toHaveLength(0);

    const kinds = internals.ui.events;
    const statusAt = kinds.findIndex(event => event.title === 'CLI Status');
    const continueAt = kinds.findIndex(event => event.kind === 'user' && event.text === 'continue');
    expect(statusAt).toBeGreaterThanOrEqual(0);
    expect(continueAt).toBeGreaterThanOrEqual(0);
    // Order, not just arrival: the queue is FIFO and /status was typed first.
    expect(statusAt).toBeLessThan(continueAt);
  });

  it('drains a command queued behind another command', async () => {
    const { internals, run } = buildController(async () => 'answer');

    // Nothing is running, so these go straight into the queue.
    internals.queuedInputs.push('/help', '/status', 'go');
    (internals as unknown as { drainQueuedInput: () => void }).drainQueuedInput();

    await waitUntil(() => run.mock.calls.length >= 1);

    expect(internals.queuedInputs).toHaveLength(0);
    expect(internals.ui.events.some(event => event.title === 'Commands')).toBe(true);
    expect(internals.ui.events.some(event => event.title === 'CLI Status')).toBe(true);
    expect(run).toHaveBeenCalledTimes(1);
  });
});

/** /narration on|off toggles the bridge's narration-folding flag through the same shape as /debug. */
describe('/narration command', () => {
  interface UiInternals { ui: { getNarrationCollapse: () => boolean } }

  it('is off by default, and on|off set it explicitly', async () => {
    const controller = new InkCoderController();
    const internals = controller as unknown as ControllerInternals & UiInternals;

    expect(internals.ui.getNarrationCollapse()).toBe(false);

    await internals.submitInput('/narration on');
    expect(internals.ui.getNarrationCollapse()).toBe(true);
    expect(internals.ui.events.some(event => event.kind === 'log' && event.text.includes('Narration: collapsed'))).toBe(true);

    await internals.submitInput('/narration off');
    expect(internals.ui.getNarrationCollapse()).toBe(false);
    expect(internals.ui.events.some(event => event.kind === 'log' && event.text.includes('Narration: expanded'))).toBe(true);
  });

  it('reports its current state with a bare /narration', async () => {
    const controller = new InkCoderController();
    const internals = controller as unknown as ControllerInternals & UiInternals;

    await internals.submitInput('/narration');
    expect(internals.ui.events.some(event => event.title === 'Narration folding')).toBe(true);
  });
});

/**
 * Esc aborts the signal, but the engine's current step keeps delivering text
 * and tool events until it unwinds. Those late events used to be written to
 * the bridge exactly like live ones.
 */
describe('streaming after Esc', () => {
  it('ignores text and tool events emitted after the abort', async () => {
    const { internals } = buildController(async (_context, options) => {
      options.onText('the answer begins');
      internals.requestStop();

      // Everything below arrives after the user was told it was cancelled.
      options.onText(' and keeps going');
      options.onToolInputStart({ id: 'late-1', toolName: 'bash' });
      options.onToolInputDelta({ id: 'late-1', delta: '{"command":"echo late"' });
      options.onToolInputEnd({ id: 'late-1' });
      options.onToolCall({ toolName: 'bash', args: { command: 'echo late' }, toolCallId: 'late-1' });
      options.onToolResult({ toolName: 'bash', result: 'late output', toolCallId: 'late-1' });
      options.onStepFinish({ finishReason: 'stop' });

      return 'Request aborted.';
    });

    await internals.runMessage('do the thing');

    const events = internals.ui.events;
    // Exactly one Abort block, and no tool trace for a call nobody will see.
    expect(events.filter(event => event.title === 'Abort')).toHaveLength(1);
    expect(events.some(event => event.kind === 'tool')).toBe(false);
    expect(events.some(event => event.text.includes('and keeps going'))).toBe(false);
    // The partial answer streamed BEFORE the abort is still finalized by it.
    expect(events.some(event => event.text.includes('the answer begins'))).toBe(true);
  });
});
