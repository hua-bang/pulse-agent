import { afterEach, describe, expect, it, vi } from 'vitest';
import { runPageTask, buildActions } from './runner';
import { PageRunRetry, PageRunStop, type PageDecision, type PageRunPorts, type PageSnapshot } from './types';

const page = (fingerprint = 'before'): PageSnapshot => ({
  id: fingerprint, documentId: 'doc-1', url: 'https://example.test', title: 'Search', text: 'Search page',
  fingerprint, truncated: false, scrollUp: false, scrollDown: false,
  targets: [{ ref: 'e1', name: 'Query', role: 'textbox', value: '', checked: null, expanded: null, operations: ['click', 'fill', 'enter'] }],
});
const decision = (action: string): PageDecision => ({ action, confidence: 0.9, goalDone: 0, stuck: 0, model: 'jev', inputTokens: 20, outputTokens: 2 });
const input = { nodeId: 'link:1', goal: 'Search for Pulse', maxSteps: 5, timeoutMs: 10_000 };
function fixture() {
  return {
    observe: vi.fn<Parameters<PageRunPorts['observe']>, ReturnType<PageRunPorts['observe']>>().mockResolvedValue(page()),
    isFresh: vi.fn<Parameters<PageRunPorts['isFresh']>, ReturnType<PageRunPorts['isFresh']>>().mockResolvedValue(true),
    decide: vi.fn<Parameters<PageRunPorts['decide']>, ReturnType<PageRunPorts['decide']>>().mockResolvedValue(decision('done')),
    text: vi.fn<Parameters<PageRunPorts['text']>, ReturnType<PageRunPorts['text']>>().mockResolvedValue('Pulse'),
    approve: vi.fn<Parameters<PageRunPorts['approve']>, ReturnType<PageRunPorts['approve']>>().mockResolvedValue(true),
    execute: vi.fn<Parameters<PageRunPorts['execute']>, ReturnType<PageRunPorts['execute']>>().mockResolvedValue(undefined),
  };
}
afterEach(() => { vi.useRealTimers(); });

describe('page_run loop', () => {
  it('fills once without implicit Enter and returns unverified completion with evidence', async () => {
    const ports = fixture();
    ports.decide.mockResolvedValueOnce(decision('fill_e1'));
    ports.observe.mockResolvedValueOnce(page()).mockResolvedValue(page('filled'));
    const result = await runPageTask(input, ports);
    expect(ports.execute).toHaveBeenCalledTimes(1);
    expect(ports.execute).toHaveBeenCalledWith(expect.objectContaining({ kind: 'fill' }), expect.anything(), 'Pulse', expect.any(AbortSignal));
    expect(result).toMatchObject({ status: 'model_done', verified: false, usage: { jevCalls: 2 }, evidence: { title: 'Search' } });
    expect(result.steps[0]).toMatchObject({ executed: true, outcome: 'page state changed' });
  });

  it('records high goal probability without treating it as independent proof of completion', async () => {
    const ports = fixture();
    ports.decide.mockResolvedValue({ ...decision('wait'), goalDone: 1 });
    expect((await runPageTask({ ...input, maxSteps: 1 }, ports)).status).toBe('budget_exhausted');
  });

  it('never executes a denied child action or tries an alternate', async () => {
    const ports = fixture();
    ports.decide.mockResolvedValue(decision('click_e1'));
    ports.approve.mockResolvedValue(false);
    const result = await runPageTask(input, ports);
    expect(result.status).toBe('blocked');
    expect(ports.execute).not.toHaveBeenCalled();
    expect(ports.decide).toHaveBeenCalledTimes(1);
  });

  it('reobserves after approval if the page changed, then asks for a new decision', async () => {
    const ports = fixture();
    ports.decide.mockResolvedValueOnce(decision('click_e1'));
    ports.isFresh.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    expect((await runPageTask(input, ports)).status).toBe('model_done');
    expect(ports.execute).not.toHaveBeenCalled();
    expect(ports.observe).toHaveBeenCalledTimes(2);
  });

  it('does not accept a stale DONE decision', async () => {
    const ports = fixture();
    ports.isFresh.mockResolvedValue(false);
    expect((await runPageTask(input, ports)).status).toBe('blocked');
    expect(ports.decide).toHaveBeenCalledTimes(3);
  });

  it('returns control for missing text without typing any fallback', async () => {
    const ports = fixture();
    ports.decide.mockResolvedValue(decision('fill_e1'));
    ports.text.mockRejectedValue(new PageRunStop('needs_input', 'Missing destination'));
    expect((await runPageTask(input, ports)).status).toBe('needs_input');
    expect(ports.execute).not.toHaveBeenCalled();
  });

  it('preserves execution evidence if the next observation fails', async () => {
    const ports = fixture();
    ports.decide.mockResolvedValue(decision('click_e1'));
    ports.observe.mockResolvedValueOnce(page()).mockRejectedValue(new Error('Page gone'));
    const result = await runPageTask(input, ports);
    expect(result.status).toBe('error');
    expect(result.steps[0]).toMatchObject({ executed: true, outcome: 'executed; observation pending' });
    expect(ports.execute).toHaveBeenCalledTimes(1);
  });

  it('never retries an uncertain browser mutation', async () => {
    const ports = fixture();
    ports.decide.mockResolvedValue(decision('click_e1'));
    ports.execute.mockRejectedValue(new Error('Input may already have executed'));
    expect((await runPageTask(input, ports)).status).toBe('error');
    expect(ports.execute).toHaveBeenCalledTimes(1);
    expect(ports.decide).toHaveBeenCalledTimes(1);
  });

  it('cancels a pending approval; a later Allow cannot execute anything', async () => {
    const ports = fixture();
    const controller = new AbortController();
    let allow!: (value: boolean) => void;
    ports.decide.mockResolvedValue(decision('click_e1'));
    ports.approve.mockImplementation(() => new Promise(resolve => { allow = resolve; }));
    const pending = runPageTask(input, ports, controller.signal);
    await vi.waitFor(() => expect(ports.approve).toHaveBeenCalled());
    controller.abort();
    expect((await pending).status).toBe('cancelled');
    allow(true);
    await Promise.resolve();
    expect(ports.execute).not.toHaveBeenCalled();
  });

  it('bounds a hung observer even when it ignores the abort signal', async () => {
    vi.useFakeTimers();
    const ports = fixture();
    ports.observe.mockImplementation(() => new Promise(() => {}));
    const pending = runPageTask({ ...input, timeoutMs: 1_000 }, ports);
    await vi.advanceTimersByTimeAsync(1_001);
    expect((await pending).status).toBe('budget_exhausted');
    expect(ports.execute).not.toHaveBeenCalled();
  });

  it('builds Enter as a separate candidate and offers no JS or coordinates', () => {
    const actions = buildActions(page());
    expect(actions.map(action => action.id)).toEqual(['click_e1', 'fill_e1', 'enter_e1', 'escape', 'wait']);
  });

  it('continues inside one run after revealing a clipped target', async () => {
    const ports = fixture();
    ports.decide.mockResolvedValueOnce(decision('click_e1')).mockResolvedValueOnce(decision('click_e1'));
    ports.execute.mockRejectedValueOnce(new PageRunRetry('clipped_by_scroll_container', 'Target revealed; re-observe before clicking.'));
    const result = await runPageTask(input, ports);
    expect(result.status).toBe('model_done');
    expect(result.steps[0]).toMatchObject({ executed: false, errorCode: 'clipped_by_scroll_container' });
    expect(result.steps[1].executed).toBe(true);
    expect(ports.observe).toHaveBeenCalledTimes(3);
  });

  it('bounds repeated pre-input recoveries and preserves the actionable reason', async () => {
    const ports = fixture();
    ports.decide.mockResolvedValue(decision('click_e1'));
    ports.execute.mockRejectedValue(new PageRunRetry('target_replaced', 'Re-observe'));
    const result = await runPageTask(input, ports);
    expect(result).toMatchObject({ status: 'blocked', errorCode: 'target_replaced' });
    expect(ports.execute).toHaveBeenCalledTimes(3);
  });

  it('validates the selected target instead of requiring unrelated content to freeze', async () => {
    const ports = fixture();
    ports.decide.mockResolvedValueOnce(decision('click_e1'));
    ports.isFresh.mockImplementation(async (_snapshot, _signal, action) => action?.id === 'click_e1');
    const result = await runPageTask({ ...input, maxSteps: 1 }, ports);
    expect(result.steps[0].executed).toBe(true);
    expect(ports.isFresh).toHaveBeenCalledWith(expect.anything(), expect.any(AbortSignal), expect.objectContaining({ id: 'click_e1' }));
  });

  it('returns a new-tab handoff after one click instead of clicking the source page again', async () => {
    const ports = fixture();
    ports.decide.mockResolvedValue(decision('click_e1'));
    let opened = false;
    ports.execute.mockImplementation(async () => { opened = true; });
    const result = await runPageTask(input, {
      ...ports,
      getOpenedPages: () => opened ? [{ workspaceId: 'ws', nodeId: 'link:new', url: 'https://video.test/1' }] : [],
    });
    expect(result).toMatchObject({ status: 'handoff', verified: false, openedPages: [{ nodeId: 'link:new' }] });
    expect(ports.execute).toHaveBeenCalledTimes(1);
    expect(ports.observe).toHaveBeenCalledTimes(1);
  });

  it('uses an observed popup request even when the click acknowledgement times out', async () => {
    const ports = fixture();
    ports.decide.mockResolvedValue(decision('click_e1'));
    let opened = false;
    ports.execute.mockImplementation(async () => {
      opened = true;
      throw new PageRunStop('error', 'Click acknowledgement timed out', 'action_timeout');
    });
    const result = await runPageTask(input, {
      ...ports, getOpenedPages: () => opened ? [{ workspaceId: 'ws', url: 'https://video.test/1' }] : [],
    });
    expect(result.status).toBe('handoff');
    expect(result.steps[0].outcome).toContain('acknowledgement incomplete');
    expect(ports.execute).toHaveBeenCalledTimes(1);
  });
});

describe('scrolling, reading and actionable exits', () => {
  it('offers a scrollable document region independently of the page root', () => {
    const snapshot = { ...page(), scrollAreas: [{ ref: 'e9', name: '正文', role: 'main', top: 0,
      height: 600, width: 800, scrollHeight: 2_000, atTop: true, atBottom: false }] };
    const actions = buildActions(snapshot);
    expect(actions).toContainEqual(expect.objectContaining({ id: 'scroll_down_e9', scrollArea: { ...snapshot.scrollAreas[0] } }));
    expect(actions.map(action => action.id)).not.toContain('scroll_up_e9');
  });

  it('retains successive readings and their URL even after a later observation fails', async () => {
    const ports = fixture();
    ports.decide.mockResolvedValue(decision('wait'));
    ports.observe.mockResolvedValueOnce({ ...page(), text: '第一节' })
      .mockResolvedValueOnce({ ...page('middle'), text: '第二节' })
      .mockResolvedValueOnce({ ...page('bottom'), url: 'https://example.test/next', text: '第三节' })
      .mockRejectedValue(new Error('Page closed'));
    const result = await runPageTask(input, ports);
    expect(result.status).toBe('error');
    expect(result.reading?.entries.map(entry => entry.text)).toEqual(['第一节', '第二节', '第三节']);
    expect(result.reading?.entries[2].url).toBe('https://example.test/next');
    expect(result.verified).toBe(false);
  });

  it('deduplicates identical views, bounds accumulated text and flags incomplete capture', async () => {
    const ports = fixture();
    let n = 0;
    ports.observe.mockImplementation(async () => ({ ...page(String(n++)), text: `${n}:` + '内容'.repeat(4_000) }));
    ports.decide.mockResolvedValue(decision('wait'));
    const result = await runPageTask({ ...input, maxSteps: 10 }, ports);
    expect(result.reading?.characters).toBeLessThanOrEqual(48_000);
    expect(result.reading?.truncated).toBe(true);
    const same = fixture();
    same.decide.mockResolvedValue(decision('wait'));
    const repeated = await runPageTask({ ...input, maxSteps: 2 }, same);
    expect(repeated.reading?.entries).toHaveLength(1);
  });

  it('identifies a missing field and separates unsupported capabilities', async () => {
    const ports = fixture();
    ports.decide.mockResolvedValue(decision('needs_input_e1'));
    const missing = await runPageTask(input, ports);
    expect(missing).toMatchObject({ status: 'needs_input', errorCode: 'missing_field_value' });
    expect(missing.reason).toContain('Query');
    ports.decide.mockResolvedValue(decision('unsupported'));
    expect(await runPageTask(input, ports)).toMatchObject({ status: 'unsupported', errorCode: 'unsupported_interaction' });
    expect(ports.execute).not.toHaveBeenCalled();
  });
});

it('retains final scroll position even when the last view has no extractable text', async () => {
  const ports = fixture();
  ports.decide.mockResolvedValueOnce(decision('wait'));
  ports.observe.mockResolvedValueOnce(page()).mockResolvedValue({ ...page('end'), text: '',
    scrollTop: 1_000, viewportHeight: 500, scrollHeight: 1_500, scrollUp: true, scrollDown: false });
  const result = await runPageTask(input, ports);
  expect(result.evidence?.scroll).toMatchObject({ top: 1_000, height: 500, scrollHeight: 1_500, atBottom: true });
  expect(result.reading?.entries).toHaveLength(1);
  expect(result.verified).toBe(false);
});
