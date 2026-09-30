// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MCP_APP_VIEW_CONTEXT_SCRIPT } from './mcp-app-view-context';

afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); document.body.innerHTML = ''; });

describe('MCP App visible UI fallback', () => {
  it('captures displayed parts and search input, updates on filtering, and excludes hidden or password content', async () => {
    vi.useFakeTimers();
    document.body.innerHTML = `<main><h1>Parts Library</h1><input placeholder="Search parts…" value="keycap">
      <div id="part">Translucent agent keycap (1U)</div><div hidden>Hidden part</div>
      <div id="below">Offscreen part</div><input type="password" value="private-secret">
      <script>privateScriptText</script></main>`;
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      const top = this.id === 'below' ? 10_000 : 10;
      return { x: 10, y: top, top, left: 10, right: 100, bottom: top + 20, width: 90, height: 20, toJSON() {} };
    });
    const postMessage = vi.spyOn(window, 'postMessage').mockImplementation(() => undefined);
    window.eval(MCP_APP_VIEW_CONTEXT_SCRIPT);
    // Observation is host-enabled; an arbitrary message cannot enable it.
    window.dispatchEvent(new MessageEvent('message', { source: null, data: { method: 'pulse/observe-context' } }));
    await vi.advanceTimersByTimeAsync(350);
    expect(postMessage).not.toHaveBeenCalled();
    window.dispatchEvent(new MessageEvent('message', { source: window, data: { method: 'pulse/observe-context' } }));
    await vi.advanceTimersByTimeAsync(350);
    const first = JSON.stringify(postMessage.mock.calls[0][0]);
    expect(first).toContain('Parts Library');
    expect(first).toContain('Translucent agent keycap');
    expect(first).toContain('keycap');
    for (const excluded of ['Hidden part', 'Offscreen part', 'private-secret', 'privateScriptText']) {
      expect(first).not.toContain(excluded);
    }
    document.querySelector('#part')!.textContent = 'Bug keycap (1U)';
    document.querySelector('input')!.value = 'bug';
    window.dispatchEvent(new Event('input'));
    await vi.advanceTimersByTimeAsync(350);
    expect(JSON.stringify(postMessage.mock.calls.at(-1)![0])).toContain('Bug keycap');
    expect(JSON.stringify(postMessage.mock.calls.at(-1)![0])).not.toContain('Translucent');
  });
});
