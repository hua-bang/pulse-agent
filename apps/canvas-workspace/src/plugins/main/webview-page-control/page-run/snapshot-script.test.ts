// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { snapshotScript } from './snapshot-script';
import type { PageSnapshot } from './types';

const runId = 'test-run';
const rect = { x: 10, y: 10, left: 10, top: 10, right: 110, bottom: 40, width: 100, height: 30, toJSON: () => ({}) };
const observe = (): PageSnapshot => window.eval(snapshotScript({ mode: 'observe', runId }));
const fresh = (page: PageSnapshot): boolean => window.eval(snapshotScript({ mode: 'fresh', runId, snapshotId: page.id }));
const targetValid = (page: PageSnapshot, ref: string): boolean => window.eval(snapshotScript({ mode: 'target', runId, snapshotId: page.id, ref, strict: true }));

beforeEach(() => {
  document.body.innerHTML = '<label for="q">查询</label><input id="q"><button id="go">搜索</button><input type="password" aria-label="Password"><input type="file" aria-label="Upload">';
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function(this: HTMLElement) {
    return this.id === 'go' ? { ...rect, x: 150, left: 150, right: 250 } : rect;
  });
  vi.stubGlobal('crypto', { randomUUID: () => 'document-1' });
  Object.defineProperty(Range.prototype, 'getBoundingClientRect', { configurable: true, value: () => rect });
  Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: (x: number) => document.querySelector(x >= 150 ? '#go' : '#q') });
});
afterEach(() => {
  window.eval(snapshotScript({ mode: 'cleanup', runId }));
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('observed browser targets', () => {
  it('keeps an unchanged target actionable when unrelated page text changes', () => {
    const clock = document.createElement('span');
    clock.textContent = 'Live count 1';
    document.body.append(clock);
    const page = observe();
    clock.textContent = 'Live count 2';
    expect(fresh(page)).toBe(false);
    expect(window.eval(snapshotScript({ mode: 'action_fresh', runId, snapshotId: page.id, ref: page.targets[0].ref }))).toBe(true);
    expect(window.eval(snapshotScript({ mode: 'action_fresh', runId, snapshotId: page.id }))).toBe(true);
    (document.querySelector('#q') as HTMLInputElement).value = 'User edited this field';
    expect(window.eval(snapshotScript({ mode: 'action_fresh', runId, snapshotId: page.id, ref: page.targets[0].ref }))).toBe(false);
  });

  it('includes field values and labels but never offers password or file fields', () => {
    const page = observe();
    expect(page.targets.map(t => t.name)).toEqual(['查询', '搜索']);
    expect(page.targets[0].operations).toEqual(['click', 'fill', 'enter']);
    expect(fresh(page)).toBe(true);
    (document.querySelector('#q') as HTMLInputElement).value = 'new';
    expect(fresh(page)).toBe(false);
  });

  it('rejects edits beyond the model preview limit in the target and related form fields', () => {
    document.body.innerHTML = '<form><textarea id="q"></textarea><input id="related"></form>';
    const field = document.querySelector('textarea')!;
    const related = document.querySelector('input')!;
    field.value = 'a'.repeat(600);
    related.value = 'b'.repeat(600);
    const page = observe();
    const target = page.targets.find(item => item.role === 'textarea')!;
    expect(target.value).toHaveLength(500);
    field.value += 'user edit';
    expect(window.eval(snapshotScript({ mode: 'action_fresh', runId, snapshotId: page.id, ref: target.ref }))).toBe(false);
    expect(targetValid(page, target.ref)).toBe(false);
    field.value = 'a'.repeat(600);
    related.value += 'another user edit';
    expect(targetValid(page, target.ref)).toBe(false);
  });

  it('rejects an identically labelled replacement even if it copies the stamp', () => {
    const page = observe();
    const old = document.querySelector('#q')!;
    expect(targetValid(page, page.targets[0].ref)).toBe(true);
    old.replaceWith(old.cloneNode(true));
    expect(targetValid(page, page.targets[0].ref)).toBe(false);
    expect(fresh(page)).toBe(false);
  });

  it('rejects overlays and disabled controls', () => {
    const page = observe();
    Object.defineProperty(document, 'elementFromPoint', { value: () => document.body });
    expect(targetValid(page, page.targets[0].ref)).toBe(false);
    (document.querySelector('#q') as HTMLInputElement).disabled = true;
    expect(fresh(page)).toBe(false);
  });

  it('keeps identities stable across observations and invalidates older snapshots', () => {
    const first = observe();
    const second = observe();
    expect(second.targets[0].ref).toBe(first.targets[0].ref);
    expect(second.id).not.toBe(first.id);
    expect(fresh(first)).toBe(false);
    expect(fresh(second)).toBe(true);
  });

  it('rejects a moved click coordinate and keyboard input after focus leaves the target', () => {
    const page = observe();
    const command = { mode: 'target' as const, runId, snapshotId: page.id, ref: page.targets[0].ref };
    expect(window.eval(snapshotScript({ ...command, point: { x: 500, y: 500 } }))).toBe(false);
    expect(window.eval(snapshotScript({ ...command, focused: true }))).toBe(false);
    (document.querySelector('#q') as HTMLInputElement).focus();
    expect(window.eval(snapshotScript({ ...command, focused: true }))).toBe(true);
    (document.querySelector('#go') as HTMLButtonElement).focus();
    expect(window.eval(snapshotScript({ ...command, focused: true }))).toBe(false);
  });

  it('reveals a clipped dropdown option before requiring a click hit, then reobserves', () => {
    document.body.innerHTML = '<ul id="menu" style="overflow-y:auto;max-height:250px"><li id="option" role="option">工具</li></ul>';
    const menu = document.querySelector('#menu') as HTMLElement;
    const option = document.querySelector('#option') as HTMLElement;
    const menuRect = { ...rect, x: 10, y: 100, top: 100, bottom: 350, height: 250 };
    Object.defineProperty(menu, 'clientHeight', { configurable: true, value: 250 });
    Object.defineProperty(menu, 'clientWidth', { configurable: true, value: 100 });
    Object.defineProperty(menu, 'scrollHeight', { configurable: true, value: 840 });
    vi.spyOn(menu, 'getBoundingClientRect').mockReturnValue(menuRect);
    vi.spyOn(option, 'getBoundingClientRect').mockImplementation(() => ({
      ...rect, x: 10, y: 516 - menu.scrollTop, top: 516 - menu.scrollTop,
      bottom: 548 - menu.scrollTop, height: 32,
    }));
    const scroll = vi.spyOn(option, 'scrollIntoView').mockImplementation(() => { menu.scrollTop = 220; });
    Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: (_x: number, y: number) => (
      y >= 100 && y < 350 && menu.scrollTop > 0 ? option : document.body
    ) });
    const page = observe();
    expect(page.targets[0].name).toBe('工具');
    expect(fresh(page)).toBe(true);
    expect(targetValid(page, page.targets[0].ref)).toBe(false);
    const result = window.eval(snapshotScript({ mode: 'reveal', runId, snapshotId: page.id, ref: page.targets[0].ref, strict: true }));
    expect(result).toMatchObject({ status: 'revealed', reason: 'clipped_by_scroll_container' });
    expect(scroll).toHaveBeenCalledTimes(1);
    const next = observe();
    expect(next.targets[0].ref).toBe(page.targets[0].ref);
    expect(targetValid(next, next.targets[0].ref)).toBe(true);
  });

  it('reports occlusion separately and never scrolls a replaced target', () => {
    const page = observe();
    const field = document.querySelector('#q') as HTMLElement;
    const scroll = vi.spyOn(field, 'scrollIntoView');
    Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: () => document.body });
    const inspected = window.eval(snapshotScript({ mode: 'inspect', runId, snapshotId: page.id, ref: page.targets[0].ref }));
    expect(inspected).toMatchObject({ status: 'blocked', reason: 'covered_by_other_element' });
    field.replaceWith(field.cloneNode(true));
    const result = window.eval(snapshotScript({ mode: 'reveal', runId, snapshotId: page.id, ref: page.targets[0].ref }));
    expect(result).toMatchObject({ status: 'stale', reason: 'target_replaced' });
    expect(scroll).not.toHaveBeenCalled();
  });
});

describe('nested document scrolling', () => {
  function documentRegion() {
    document.body.innerHTML = '<main aria-label="正文" style="overflow-y:auto"><p>Visible section</p></main>';
    const main = document.querySelector('main')!;
    Object.defineProperties(main, {
      clientHeight: { configurable: true, value: 200 },
      clientWidth: { configurable: true, value: 400 },
      scrollHeight: { configurable: true, value: 1_000 },
    });
    vi.spyOn(main, 'getBoundingClientRect').mockReturnValue({ ...rect, width: 400, height: 200, right: 410, bottom: 210 });
    Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: () => main });
    const scroll = vi.fn(({ top }: { top: number }) => { main.scrollTop += top; });
    Object.defineProperty(main, 'scrollBy', { configurable: true, value: scroll });
    return { main, scroll };
  }

  it('observes and scrolls the same region by an overlapping viewport, then reports its new position', () => {
    const { main, scroll } = documentRegion();
    const page = observe();
    expect(page.scrollAreas).toHaveLength(1);
    const area = page.scrollAreas![0];
    expect(area).toMatchObject({ name: '正文', atTop: true, atBottom: false });
    expect(window.eval(snapshotScript({ mode: 'scroll', runId, snapshotId: page.id, ref: area.ref, direction: 'down' }))).toMatchObject({ status: 'scrolled' });
    expect(scroll).toHaveBeenCalledTimes(1);
    expect(main.scrollTop).toBeGreaterThan(0);
    expect(main.scrollTop).toBeLessThan(200);
    expect(observe().scrollAreas![0].atTop).toBe(false);
  });

  it('reads only the selected region without rebuilding interactive targets', () => {
    const { main } = documentRegion();
    const aside = document.createElement('aside');
    aside.textContent = 'Sidebar text must not enter the selected region';
    document.body.append(aside);
    const first = observe();
    const area = first.scrollAreas![0];
    const reading = { documentId: first.documentId, url: first.url, ref: area.ref, signature: area.signature };
    const selected: PageSnapshot = window.eval(snapshotScript({ mode: 'observe', runId, reading }));
    expect(selected.targets).toEqual([]);
    expect(selected.text).toContain('Visible section');
    expect(selected.text).not.toContain('Sidebar text');
    expect(selected.readingRegionLost).toBe(false);
    main.setAttribute('aria-label', 'Different purpose');
    const changed: PageSnapshot = window.eval(snapshotScript({ mode: 'observe', runId, reading }));
    expect(changed.readingRegionLost).toBe(true);
  });

  it('allows an image-only viewport or a persistent media progress indicator to be traversed', () => {
    const { main } = documentRegion();
    const first = observe();
    const area = first.scrollAreas![0];
    main.innerHTML = '<img alt="diagram"><div role="progressbar" aria-valuenow="0"></div>';
    const reading = { documentId: first.documentId, url: first.url, ref: area.ref, signature: area.signature };
    const selected: PageSnapshot = window.eval(snapshotScript({ mode: 'observe', runId, reading }));
    expect(selected.text).toBe('');
    expect(selected.loading).toBe(false);
    expect(selected.scrollAreas![0].atBottom).toBe(false);
  });

  it('reports loading and rejects a replacement during lightweight observation', () => {
    const { main } = documentRegion();
    const first = observe();
    const area = first.scrollAreas![0];
    const reading = { documentId: first.documentId, url: first.url, ref: area.ref, signature: area.signature };
    main.setAttribute('aria-busy', 'true');
    expect(window.eval(snapshotScript({ mode: 'observe', runId, reading })).loading).toBe(true);
    main.replaceWith(main.cloneNode(true));
    expect(window.eval(snapshotScript({ mode: 'observe', runId, reading })).readingRegionLost).toBe(true);
  });

  it('excludes text clipped by a scroll container even when its coordinates lie inside the window', () => {
    const { main } = documentRegion();
    main.innerHTML = '<p id="shown">Visible section</p><p id="clipped">Hidden future section</p>';
    vi.spyOn(Range.prototype, 'getBoundingClientRect').mockImplementation(function(this: Range) {
      return this.commonAncestorContainer.parentElement?.id === 'clipped'
        ? { ...rect, y: 300, top: 300, bottom: 330 } : rect;
    });
    const page = observe();
    expect(page.text).toContain('Visible section');
    expect(page.text).not.toContain('Hidden future section');
  });

  it('rejects replaced regions and external scrolling before dispatch', () => {
    const { main, scroll } = documentRegion();
    const page = observe();
    const ref = page.scrollAreas![0].ref;
    main.scrollTop = 100;
    expect(window.eval(snapshotScript({ mode: 'scroll_fresh', runId, snapshotId: page.id, ref }))).toBe(false);
    main.replaceWith(main.cloneNode(true));
    expect(window.eval(snapshotScript({ mode: 'scroll', runId, snapshotId: page.id, ref, direction: 'down' }))).toMatchObject({ status: 'stale' });
    expect(scroll).not.toHaveBeenCalled();
  });
});

it('uses viewport bounds for the document scrollport after the root box moves above the window', () => {
  const html = document.documentElement;
  const style = html.getAttribute('style');
  try {
    html.style.overflowX = 'auto';
    html.style.overflowY = 'auto';
    vi.spyOn(html, 'getBoundingClientRect').mockReturnValue({ ...rect, x: 0, left: 0,
      y: -1_000, top: -1_000, width: 1_000, right: 1_000, height: 2_000, bottom: 1_000 });
    vi.spyOn(html, 'clientHeight', 'get').mockReturnValue(700);
    vi.spyOn(html, 'clientWidth', 'get').mockReturnValue(1_000);
    vi.spyOn(html, 'scrollHeight', 'get').mockReturnValue(2_000);
    const page = observe();
    expect(page.text).toContain('查询');
    expect(page.targets.find(target => target.name === 'Query' || target.name === '查询')?.requiresScroll).toBe(false);
    expect(page.viewportHeight).toBe(window.innerHeight);
    expect(page.scrollHeight).toBe(2_000);
  } finally {
    if (style === null) html.removeAttribute('style'); else html.setAttribute('style', style);
  }
});
