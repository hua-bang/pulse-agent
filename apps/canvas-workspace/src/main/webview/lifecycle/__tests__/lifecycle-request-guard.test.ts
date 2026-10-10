import { describe, expect, it } from 'vitest';
import {
  beginLifecycleRequest,
  serializeLifecycleTransition,
} from '../lifecycle-request-guard';

describe('lifecycle request guard', () => {
  it('lets a newer intent supersede an in-flight request for the same guest only', () => {
    const old = beginLifecycleRequest(1);
    const other = beginLifecycleRequest(2);
    const latest = beginLifecycleRequest(1);

    expect(old.isCurrent()).toBe(false);
    expect(other.isCurrent()).toBe(true);
    expect(latest.isCurrent()).toBe(true);

    old.finish();
    expect(latest.isCurrent()).toBe(true);
    latest.finish();
    expect(latest.isCurrent()).toBe(false);
    other.finish();
  });

  it('serializes transitions for one guest without blocking another guest', async () => {
    const events: string[] = [];
    let releaseFirst = (): void => {};
    const firstGate = new Promise<void>((resolve) => { releaseFirst = resolve; });

    const first = serializeLifecycleTransition(1, async () => {
      events.push('first:start');
      await firstGate;
      events.push('first:end');
    });
    const second = serializeLifecycleTransition(1, async () => {
      events.push('second');
    });
    const other = serializeLifecycleTransition(2, async () => {
      events.push('other');
    });
    await other;
    expect(events).toEqual(['first:start', 'other']);

    releaseFirst();
    await Promise.all([first, second]);
    expect(events).toEqual(['first:start', 'other', 'first:end', 'second']);
  });
});
