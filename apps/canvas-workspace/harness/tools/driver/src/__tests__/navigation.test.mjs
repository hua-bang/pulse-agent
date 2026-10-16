import vm from 'node:vm';
import { Window } from 'happy-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as navigation from '../navigation.mjs';
import { evaluateRenderer } from '../renderer.mjs';

vi.mock('../renderer.mjs', () => ({ evaluateRenderer: vi.fn() }));
vi.mock('../utils.mjs', () => ({
  waitFor: vi.fn(async (poll) => {
    if (!await poll()) throw new Error('not ready');
  }),
}));

let window;
afterEach(() => {
  window?.happyDOM.abort();
  vi.clearAllMocks();
});

function fixture({ route = '/?workspaceId=default', nodes = [], edges = [], ok = true } = {}) {
  window?.happyDOM.abort();
  window = new Window({ url: `http://localhost/#${route}` });
  window.document.body.innerHTML = `<div class="canvas-host"><div class="canvas-container" data-canvas-id="default">
    <div class="canvas-empty-hint"><section class="canvas-empty-card">
      <button class="canvas-empty-action">项目</button>
      <button class="canvas-empty-action">Brief</button>
      <button class="canvas-empty-action">Agent</button>
    </section></div></div></div>`;
  const load = vi.fn(async () => ({ ok, data: { nodes, edges } }));
  const context = vm.createContext({
    document: window.document, location: window.location,
    window: { canvasWorkspace: { store: { load } } },
    URL, innerWidth: 1200, innerHeight: 800,
    getComputedStyle: (el) => window.getComputedStyle(el),
  });
  // happy-dom has no layout engine. Keep DOM/style behavior, supply layout boxes.
  window.HTMLElement.prototype.getBoundingClientRect = function () {
    const hidden = this.closest('[hidden], [style*="display: none"]');
    return { width: hidden ? 0 : 400, height: hidden ? 0 : 200, top: 0, left: 0, right: 400, bottom: 200 };
  };
  const evaluate = (expression) => vm.runInContext(expression, context);
  return { load, evaluate, ready: () => evaluate(navigation.ONBOARD_READY_EXPRESSION) };
}

describe('onboard navigation', () => {
  it('targets the blank default workspace without a removed tutorial node', () => {
    expect(navigation.onboardHashRoute()).toBe('/?workspaceId=default');
  });

  it('opens the route and accepts the current multilingual empty UI', async () => {
    const page = fixture();
    evaluateRenderer.mockImplementation(async (_session, expression) => page.evaluate(expression));
    await navigation.applyStartupNavigation({}, { target: 'onboard', route: '/chat' });
    expect(window.location.hash).toBe('#/?workspaceId=default');
    expect(page.load).toHaveBeenCalledWith('default');
  });

  it('requires an empty stored document including edges', async () => {
    expect(await fixture().ready()).toBe(true);
    expect(await fixture({ nodes: [{ id: 'node-welcome-note' }] }).ready()).toBe(false);
    expect(await fixture({ edges: [{ id: 'orphan-edge' }] }).ready()).toBe(false);
    expect(await fixture({ ok: false }).ready()).toBe(false);
  });

  it.each(['/chat?workspaceId=default', '/home', '/?workspaceId=other', '/?workspaceId=default&nodeId=node-welcome-note'])('rejects wrong or legacy route %s', async (route) => {
    expect(await fixture({ route }).ready()).toBe(false);
  });

  it.each(['.canvas-host', '.canvas-empty-card', '.canvas-empty-action'])('rejects hidden %s', async (selector) => {
    const page = fixture();
    window.document.querySelector(selector).style.display = 'none';
    expect(await page.ready()).toBe(false);
  });

  it('does not let a hidden background canvas mask the visible canvas', async () => {
    const page = fixture();
    const host = window.document.querySelector('.canvas-host');
    host.style.display = 'none';
    window.document.body.insertAdjacentHTML('beforeend', '<div class="canvas-host"><div class="canvas-container" data-canvas-id="default"><div data-node-id="existing"></div></div></div>');
    expect(await page.ready()).toBe(false);
  });

  it('rejects loading, incomplete actions, disabled actions and rendered nodes', async () => {
    for (const change of [
      (doc) => { doc.querySelector('.canvas-empty-card').remove(); },
      (doc) => { doc.querySelector('.canvas-empty-action').remove(); },
      (doc) => { doc.querySelector('.canvas-empty-action').disabled = true; },
      (doc) => { doc.querySelector('.canvas-container').insertAdjacentHTML('beforeend', '<div data-node-id="legacy"></div>'); },
    ]) {
      const page = fixture();
      change(window.document);
      expect(await page.ready()).toBe(false);
    }
  });

  it('rejects a stale visible workspace while the requested route changes', async () => {
    const page = fixture();
    window.document.querySelector('.canvas-container').setAttribute('data-canvas-id', 'other');
    expect(await page.ready()).toBe(false);
  });

  it('ignores legacy tutorial text without the current empty canvas', async () => {
    const page = fixture();
    window.document.body.innerHTML = '<p>Welcome to Pulse Canvas 欢迎使用 Pulse Canvas workspace for thinking with AI How to Begin</p>';
    expect(await page.ready()).toBe(false);
  });

  it.each(['visibility: hidden', 'opacity: 0'])('rejects an invisible ancestor with %s', async (style) => {
    const page = fixture();
    window.document.querySelector('.canvas-host').setAttribute('style', style);
    expect(await page.ready()).toBe(false);
  });

  it('rejects missing document data and rechecks visibility after loading', async () => {
    const page = fixture();
    page.load.mockResolvedValueOnce({ ok: true, data: null });
    expect(await page.ready()).toBe(false);
    page.load.mockImplementation(async () => {
      window.document.querySelector('.canvas-host').hidden = true;
      return { ok: true, data: { nodes: [], edges: [] } };
    });
    expect(await page.ready()).toBe(false);
  });

  it('rechecks the route after the asynchronous workspace read', async () => {
    const page = fixture();
    page.load.mockImplementation(async () => {
      window.location.hash = '#/chat';
      return { ok: true, data: { nodes: [], edges: [] } };
    });
    expect(await page.ready()).toBe(false);
  });
});
