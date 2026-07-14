import { describe, expect, it } from 'vitest';
import {
  buildFreezeRecord,
  probeFreezeState,
  type FreezeProbeResult,
} from '../freeze-probe';

const probe = (overrides: Partial<FreezeProbeResult> = {}): FreezeProbeResult => ({
  scrollX: 0,
  scrollY: 0,
  dirty: false,
  hasEditable: false,
  nonTrivialDom: true,
  ...overrides,
});

describe('probeFreezeState', () => {
  it('returns the guest report when it settles in time', async () => {
    const wc = { executeJavaScript: async () => probe({ scrollX: 10, scrollY: 420, dirty: true }) };
    await expect(probeFreezeState(wc, 1_000)).resolves.toMatchObject({
      scrollX: 10,
      scrollY: 420,
      dirty: true,
    });
  });

  it('resolves undefined when the guest never answers — the bounded fail-closed path', async () => {
    const wc = { executeJavaScript: () => new Promise<unknown>(() => {}) };
    await expect(probeFreezeState(wc, 50)).resolves.toBeUndefined();
  });

  it('resolves undefined on guest script rejection', async () => {
    const wc = { executeJavaScript: () => Promise.reject(new Error('boom')) };
    await expect(probeFreezeState(wc, 1_000)).resolves.toBeUndefined();
  });

  it('resolves undefined on a malformed guest reply (script returned null)', async () => {
    const wc = { executeJavaScript: async () => null };
    await expect(probeFreezeState(wc, 1_000)).resolves.toBeUndefined();
    const partial = { executeJavaScript: async () => ({ scrollX: 1 }) };
    await expect(probeFreezeState(partial, 1_000)).resolves.toBeUndefined();
  });
});

describe('buildFreezeRecord', () => {
  it('fails closed on a missing probe: dirty + non-reloadable, so never discarded', () => {
    const record = buildFreezeRecord('https://example.com/', 'data:image/png;x', undefined);
    expect(record).toMatchObject({
      url: 'https://example.com/',
      imageDataUrl: 'data:image/png;x',
      dirty: true,
      reloadable: false,
    });
  });

  it('carries scroll + dirty state through from the probe', () => {
    const record = buildFreezeRecord(
      'https://example.com/docs',
      undefined,
      probe({ scrollX: 3, scrollY: 999, dirty: true }),
    );
    expect(record).toMatchObject({
      url: 'https://example.com/docs',
      scrollX: 3,
      scrollY: 999,
      dirty: true,
      reloadable: true,
    });
  });

  it('marks blob: urls non-reloadable — the content has no server to reload from', () => {
    expect(buildFreezeRecord('blob:https://a/x', undefined, probe()).reloadable).toBe(false);
  });

  it('marks a POPULATED about:blank non-reloadable, but a truly blank one reloadable', () => {
    expect(
      buildFreezeRecord('about:blank', undefined, probe({ nonTrivialDom: true })).reloadable,
    ).toBe(false);
    expect(
      buildFreezeRecord('about:blank', undefined, probe({ nonTrivialDom: false })).reloadable,
    ).toBe(true);
  });

  it('keeps ordinary http(s) pages reloadable regardless of DOM content', () => {
    expect(
      buildFreezeRecord('https://example.com/', undefined, probe({ nonTrivialDom: true })).reloadable,
    ).toBe(true);
  });
});
