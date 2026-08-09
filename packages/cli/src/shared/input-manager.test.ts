import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { InputManager } from './input-manager.js';

describe('InputManager', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('resolves pending clarification with trimmed user input', async () => {
    const manager = new InputManager();

    const pending = manager.requestInput({
      id: 'clarify-1',
      question: 'Need more details?',
      timeout: 5_000
    });

    expect(manager.hasPendingRequest()).toBe(true);
    expect(manager.handleUserInput('  yes, continue  ')).toBe(true);

    await expect(pending).resolves.toBe('yes, continue');
    expect(manager.hasPendingRequest()).toBe(false);
  });

  it('resolves an empty answer to the advertised default', async () => {
    const manager = new InputManager();

    const pending = manager.requestInput({
      id: 'clarify-default',
      question: 'Proceed?',
      defaultAnswer: 'yes',
      timeout: 5_000
    });

    // The prompt says "(Default: yes)", so bare Enter has to send yes — before
    // this the empty string went to the engine and the offer was decoration.
    expect(manager.resolveAnswer('   ')).toBe('yes');
    // Anything actually typed still wins over the default.
    expect(manager.resolveAnswer(' no ')).toBe('no');

    expect(manager.handleUserInput(manager.resolveAnswer(''))).toBe(true);
    await expect(pending).resolves.toBe('yes');
  });

  it('leaves an empty answer empty when the request has no default', async () => {
    const manager = new InputManager();

    const pending = manager.requestInput({
      id: 'clarify-no-default',
      question: 'Which file?',
      timeout: 5_000
    });

    expect(manager.resolveAnswer('')).toBe('');
    manager.handleUserInput(manager.resolveAnswer(''));
    await expect(pending).resolves.toBe('');

    // With nothing pending it is a plain trim, so hosts can call it blind.
    expect(manager.resolveAnswer('  hello  ')).toBe('hello');
  });

  it('rejects a second request while one is pending', async () => {
    const manager = new InputManager();

    const first = manager.requestInput({
      id: 'clarify-1',
      question: 'First question?',
      timeout: 5_000
    });

    const second = manager.requestInput({
      id: 'clarify-2',
      question: 'Second question?',
      timeout: 5_000
    });

    await expect(second).rejects.toThrow('already pending');

    manager.handleUserInput('done');
    await expect(first).resolves.toBe('done');
  });

  it('rejects request when timeout is reached', async () => {
    vi.useFakeTimers();

    const manager = new InputManager();
    const pending = manager.requestInput({
      id: 'clarify-timeout',
      question: 'Will timeout',
      timeout: 100
    });

    const rejection = expect(pending).rejects.toThrow('timed out');

    await vi.advanceTimersByTimeAsync(120);
    await rejection;
    expect(manager.hasPendingRequest()).toBe(false);
  });
});
