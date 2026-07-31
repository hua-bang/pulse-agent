// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { acquireInteractionShield } from './interactionShield';

describe('acquireInteractionShield', () => {
  afterEach(() => {
    document.body.replaceChildren();
  });

  it('shields guests that mount after an overlay has already opened', async () => {
    const existing = document.createElement('webview');
    document.body.appendChild(existing);
    const release = acquireInteractionShield();

    const late = document.createElement('webview');
    document.body.appendChild(late);
    await Promise.resolve();

    expect(existing.style.pointerEvents).toBe('none');
    expect(late.style.pointerEvents).toBe('none');

    release();
    expect(existing.style.pointerEvents).toBe('');
    expect(late.style.pointerEvents).toBe('');
  });

  it('does not leak an observer when overlapping shields start before any guest mounts', async () => {
    const releaseFirst = acquireInteractionShield();
    const releaseSecond = acquireInteractionShield();
    releaseFirst();
    releaseSecond();

    const late = document.createElement('webview');
    document.body.appendChild(late);
    await Promise.resolve();

    expect(late.style.pointerEvents).toBe('');
  });
});
