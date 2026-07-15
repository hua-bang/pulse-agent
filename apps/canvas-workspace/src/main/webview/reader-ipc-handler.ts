import { getWebContentsForNode } from './registry';
import {
  captureScreenshot,
  readA11y,
  readDOM,
  type WebReadInput,
  type WebReadResult,
  type WebReadStrategy,
} from './reader';

const DEFAULT_MAX_CHARS = 12_000;
const DEFAULT_SPARSE_THRESHOLD = 200;

export async function handleWebRead(payload: WebReadInput): Promise<WebReadResult> {
  const { workspaceId, nodeId } = payload ?? {};

  if (!workspaceId || !nodeId) {
    return { ok: false, nodeId: nodeId ?? '', strategy: 'dom', error: 'workspaceId and nodeId are required' };
  }

  const wc = getWebContentsForNode(workspaceId, nodeId);
  if (!wc) {
    return { ok: false, nodeId, strategy: 'dom', error: `No active webview found for node ${workspaceId}::${nodeId}` };
  }

  const strategy: WebReadStrategy = payload.strategy ?? 'auto';
  const maxChars = payload.maxChars ?? DEFAULT_MAX_CHARS;
  const sparseThreshold = payload.sparseThreshold ?? DEFAULT_SPARSE_THRESHOLD;

  if (strategy === 'dom' || strategy === 'auto') {
    const result = await readDOM(wc, maxChars);
    if (strategy === 'dom') {
      return result.ok
        ? { ok: true, nodeId, strategy: 'dom', text: result.text, title: result.title, url: result.url }
        : { ok: false, nodeId, strategy: 'dom', error: result.error! };
    }
    if (result.ok && result.text.trim().length >= sparseThreshold) {
      return { ok: true, nodeId, strategy: 'dom', text: result.text, title: result.title, url: result.url };
    }
  }

  if (strategy === 'a11y' || strategy === 'auto') {
    const result = await readA11y(wc);
    if (strategy === 'a11y') {
      return result.ok
        ? { ok: true, nodeId, strategy: 'a11y', text: result.text }
        : { ok: false, nodeId, strategy: 'a11y', error: result.error! };
    }
    if (result.ok && result.text.trim().length >= sparseThreshold) {
      return { ok: true, nodeId, strategy: 'a11y', text: result.text };
    }
  }

  const result = await captureScreenshot(wc);
  return result.ok
    ? { ok: true, nodeId, strategy: 'screenshot', imagePath: result.imagePath }
    : { ok: false, nodeId, strategy: 'screenshot', error: result.error! };
}
