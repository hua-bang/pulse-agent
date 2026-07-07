import { createDomPickerScript } from '../../../../shared/dom-snapshot-script';
import type { AgentContextDomSelectionRef } from '../../types';

const START_MESSAGE = 'pulse-canvas-dom-picker:start';
const RESULT_MESSAGE = 'pulse-canvas-dom-picker:result';
const PICKER_RESULT_TIMEOUT_MS = 35_000;

export interface DomPickerResult {
  ok: boolean;
  selection?: AgentContextDomSelectionRef;
  error?: string;
  cancelled?: boolean;
}

const HTML_DOM_PICKER_BRIDGE = `
<script data-pulse-canvas-dom-picker-bridge>
(() => {
  if (window.__pulseCanvasDomPickerBridgeInstalled) return;
  window.__pulseCanvasDomPickerBridgeInstalled = true;
  const START_MESSAGE = '${START_MESSAGE}';
  const RESULT_MESSAGE = '${RESULT_MESSAGE}';
  window.addEventListener('message', async (event) => {
    if (event.source !== window.parent) return;
    const data = event.data;
    if (!data || data.type !== START_MESSAGE || typeof data.requestId !== 'string' || typeof data.script !== 'string') return;
    try {
      const result = await window.eval(data.script);
      window.parent.postMessage({ type: RESULT_MESSAGE, requestId: data.requestId, result }, '*');
    } catch (err) {
      window.parent.postMessage({
        type: RESULT_MESSAGE,
        requestId: data.requestId,
        result: { ok: false, error: err && err.message ? String(err.message) : String(err) },
      }, '*');
    }
  });
})();
</script>`;

export function appendDomPickerBridge(html: string): string {
  if (html.includes('data-pulse-canvas-dom-picker-bridge')) return html;
  if (/<\/body\s*>/i.test(html)) {
    return html.replace(/<\/body\s*>/i, `${HTML_DOM_PICKER_BRIDGE}</body>`);
  }
  return `${html}\n${HTML_DOM_PICKER_BRIDGE}`;
}

export function pickDomElementFromHtmlIframe(
  iframe: HTMLIFrameElement | null,
  workspaceId: string,
  nodeId: string,
): Promise<DomPickerResult> {
  const frameWindow = iframe?.contentWindow;
  if (!frameWindow) {
    return Promise.resolve({ ok: false, error: 'HTML preview is not ready yet.' });
  }

  const requestId = `dom-picker-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const script = createDomPickerScript(workspaceId, nodeId);

  return new Promise((resolve) => {
    let settled = false;
    let timeout = 0;
    const finish = (result: DomPickerResult) => {
      if (settled) return;
      settled = true;
      window.removeEventListener('message', handleMessage);
      window.clearTimeout(timeout);
      resolve(result);
    };
    const handleMessage = (event: MessageEvent) => {
      if (event.source !== frameWindow) return;
      const data = event.data;
      if (!data || data.type !== RESULT_MESSAGE || data.requestId !== requestId) return;
      finish(data.result as DomPickerResult);
    };

    timeout = window.setTimeout(() => {
      finish({ ok: false, error: 'DOM picker timed out before the HTML preview responded.' });
    }, PICKER_RESULT_TIMEOUT_MS);

    window.addEventListener('message', handleMessage);
    try {
      frameWindow.postMessage({ type: START_MESSAGE, requestId, script }, '*');
    } catch (err) {
      finish({ ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  });
}
