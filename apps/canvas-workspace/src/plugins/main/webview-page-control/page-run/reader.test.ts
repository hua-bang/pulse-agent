import { afterEach, describe, expect, it, vi } from 'vitest';
import { runPageTask } from './runner';
import { PageRunRetry, type PageRunPorts, type PageSnapshot } from './types';

const input = { nodeId: 'link:1', goal: 'Read the article', mode: 'read' as const, maxSteps: 60, timeoutMs: 120_000 };
function fixture(end = 50) {
  let position = 0;
  const snapshot = (): PageSnapshot => ({
    id: `s-${position}`, documentId: 'doc', url: 'https://example.test', title: 'Article', text: `Paragraph ${position}`,
    fingerprint: `state-${position}`, targets: [], scrollUp: false, scrollDown: false, truncated: false,
    scrollAreas: [{ ref: 'main', name: 'Article', role: 'main', signature: 'main', top: position * 85,
      height: 100, width: 600, scrollHeight: end * 85 + 100, atTop: position === 0, atBottom: position === end }],
  });
  const ports = {
    observe: vi.fn<Parameters<NonNullable<PageRunPorts['observe']>>, ReturnType<NonNullable<PageRunPorts['observe']>>>().mockImplementation(async () => snapshot()),
    decide: vi.fn<Parameters<NonNullable<PageRunPorts['decide']>>, ReturnType<NonNullable<PageRunPorts['decide']>>>().mockResolvedValue({ action: 'scroll_down_main', confidence: 0.99,
      goalDone: 0, stuck: 0, model: 'fixture', inputTokens: 10, outputTokens: 1 }),
    isFresh: vi.fn<Parameters<NonNullable<PageRunPorts['isFresh']>>, ReturnType<NonNullable<PageRunPorts['isFresh']>>>().mockResolvedValue(true),
    approve: vi.fn<Parameters<NonNullable<PageRunPorts['approve']>>, ReturnType<NonNullable<PageRunPorts['approve']>>>().mockResolvedValue(true),
    execute: vi.fn<Parameters<NonNullable<PageRunPorts['execute']>>, ReturnType<NonNullable<PageRunPorts['execute']>>>().mockImplementation(async () => { position = Math.min(end, position + 1); }),
    text: vi.fn<Parameters<NonNullable<PageRunPorts['text']>>, ReturnType<NonNullable<PageRunPorts['text']>>>(), settle: vi.fn<Parameters<NonNullable<PageRunPorts['settle']>>, ReturnType<NonNullable<PageRunPorts['settle']>>>().mockResolvedValue(undefined),
  };
  return { ports, snapshot, setEnd: (value: number) => { end = value; } };
}
afterEach(() => { vi.useRealTimers(); });

describe('bounded reading controller', () => {
  it('collects 51 views with one Jev selection, preserving per-action approval and freshness', async () => {
    const { ports } = fixture();
    const result = await runPageTask(input, ports);
    expect(result).toMatchObject({ status: 'read_complete', verified: false, usage: { jevCalls: 1 }, reading: { truncated: false } });
    expect(result.reading?.entries).toHaveLength(51);
    expect(result.reading?.entries.at(-1)?.text).toBe('Paragraph 50');
    expect(ports.execute).toHaveBeenCalledTimes(50);
    expect(ports.approve).toHaveBeenCalledTimes(50);
    expect(ports.isFresh.mock.calls.length).toBeGreaterThanOrEqual(100);
    expect(result.steps[1]).toMatchObject({ source: 'program' });
    expect(result.steps[1].confidence).toBeUndefined();
    expect(ports.text).not.toHaveBeenCalled();
    expect(ports.decide.mock.calls[0][2].every(action => ['scroll_down', 'wait'].includes(action.kind))).toBe(true);
    expect(ports.observe).toHaveBeenCalledWith(expect.any(AbortSignal), expect.objectContaining({ ref: 'main', documentId: 'doc' }));
  });

  it('keeps act mode deciding each step and preserves the action budget', async () => {
    const { ports } = fixture(80);
    const act = await runPageTask({ ...input, mode: 'act', maxSteps: 20 }, ports);
    expect(act.usage.jevCalls).toBe(20);
    expect(ports.execute).toHaveBeenCalledTimes(20);
    const second = fixture(80);
    const read = await runPageTask({ ...input, maxSteps: 20 }, second.ports);
    expect(read).toMatchObject({ status: 'budget_exhausted', usage: { jevCalls: 1 } });
    expect(second.ports.execute).toHaveBeenCalledTimes(20);
    expect(read.reading?.entries.map(entry => entry.text)).toEqual(act.reading?.entries.map(entry => entry.text));
  });

  it('does not accept an early done or a click in read mode', async () => {
    for (const action of ['done', 'click_main']) {
      const { ports } = fixture();
      ports.decide.mockResolvedValue({ action, confidence: 1, goalDone: 1, stuck: 0, model: 'fixture', inputTokens: 0, outputTokens: 0 });
      expect((await runPageTask(input, ports)).status).toBe('unsupported');
      expect(ports.execute).not.toHaveBeenCalled();
    }
  });

  it('rechecks a provisional bottom and reads content appended during settling', async () => {
    const { ports, setEnd } = fixture(2);
    ports.settle.mockImplementation(async () => { if (ports.execute.mock.calls.length === 2) setEnd(4); });
    const result = await runPageTask(input, ports);
    expect(result.status).toBe('read_complete');
    expect(result.reading?.entries.at(-1)?.text).toBe('Paragraph 4');
    expect(ports.execute).toHaveBeenCalledTimes(4);
  });

  it('waits for delayed virtual text before scrolling again', async () => {
    const { ports, snapshot } = fixture(2);
    let waiting = 0;
    ports.observe.mockImplementation(async () => {
      if (ports.execute.mock.calls.length === 1 && waiting++ < 2) return { ...snapshot(), text: '', loading: true };
      return snapshot();
    });
    const result = await runPageTask(input, ports);
    expect(result.reading?.entries.map(entry => entry.text)).toEqual(['Paragraph 0', 'Paragraph 1', 'Paragraph 2']);
    expect(ports.execute).toHaveBeenCalledTimes(2);
  });

  it('never bypasses a declined approval and does not replay uncertain input', async () => {
    const denied = fixture();
    denied.ports.approve.mockResolvedValue(false);
    expect((await runPageTask(input, denied.ports)).status).toBe('blocked');
    expect(denied.ports.execute).not.toHaveBeenCalled();
    const failed = fixture();
    failed.ports.execute.mockRejectedValue(new Error('outcome uncertain'));
    expect((await runPageTask(input, failed.ports)).status).toBe('error');
    expect(failed.ports.execute).toHaveBeenCalledTimes(1);
  });

  it('reselects after a pre-input rejection and bounds repeated recovery', async () => {
    const { ports } = fixture(2);
    ports.execute.mockRejectedValueOnce(new PageRunRetry('scroll_position_changed', 'User scrolled'));
    const result = await runPageTask(input, ports);
    expect(result.status).toBe('read_complete');
    expect(ports.decide).toHaveBeenCalledTimes(2);
    const repeated = fixture();
    repeated.ports.execute.mockRejectedValue(new PageRunRetry('scroll_region_replaced', 'Replaced'));
    expect((await runPageTask(input, repeated.ports)).status).toBe('blocked');
    expect(repeated.ports.execute).toHaveBeenCalledTimes(3);
  });

  it('stops on navigation with captured text and no new-document scroll', async () => {
    const { ports, snapshot } = fixture();
    ports.observe.mockImplementation(async () => ({ ...snapshot(), documentId: ports.execute.mock.calls.length ? 'new-doc' : 'doc' }));
    const result = await runPageTask(input, ports);
    expect(result).toMatchObject({ status: 'blocked', errorCode: 'reading_document_changed' });
    expect(ports.execute).toHaveBeenCalledTimes(1);
  });

  it('stops before scrolling beyond capture capacity', async () => {
    const { ports, snapshot } = fixture(100);
    ports.observe.mockImplementation(async () => ({ ...snapshot(), text: snapshot().text.padEnd(6_000, 'x') }));
    const result = await runPageTask(input, ports);
    expect(result).toMatchObject({ status: 'budget_exhausted', errorCode: 'reading_capacity', reading: { characters: 48_000 } });
    expect(ports.execute).toHaveBeenCalledTimes(7);
  });

  it('cancels pending approval without late input', async () => {
    const { ports } = fixture();
    const controller = new AbortController();
    ports.approve.mockImplementation(async () => { controller.abort(); return true; });
    expect((await runPageTask(input, ports, controller.signal)).status).toBe('cancelled');
    expect(ports.execute).not.toHaveBeenCalled();
  });
});
