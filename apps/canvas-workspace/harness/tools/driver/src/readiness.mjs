import { evaluateRenderer } from './renderer.mjs';
import { waitFor } from './utils.mjs';

/**
 * When `start` may return. Two stages:
 *
 * 1. Rendered (required): React replaced index.html's static .boot-screen.
 *    Positive match on React output — the initial about:blank also has no
 *    .boot-screen, so an absence-only check passes before index.html loads.
 * 2. Settled (best effort): first-paint content finished mounting. The shell
 *    renders before lazy node bodies, file previews and webview guests, so a
 *    screenshot right after stage 1 shows empty cards and blank webviews.
 *
 * Settled waits on an explicit list of first-paint signals, not a generic
 * `--loading` match: states such as an update check can legitimately stay
 * loading (e.g. when the network is blocked) and must not stall every launch.
 * It never fails the launch; a timeout is reported with what was pending.
 */

export const APP_RENDERED_EXPRESSION = "document.querySelector('#root > :not(.boot-screen)') !== null";

export const PENDING_CONTENT_SELECTORS = {
  'node-body': '.node-body:empty',
  'file-preview': '.file-preview--loading',
  'chat-messages': '.chat-messages--loading',
};

export const pendingContentExpression = (selectors = PENDING_CONTENT_SELECTORS) => `(() => {
  const pending = Object.entries(${JSON.stringify(selectors)})
    .filter(([, selector]) => document.querySelector(selector))
    .map(([name]) => name);
  for (const webview of document.querySelectorAll('webview')) {
    try {
      if (webview.isLoading()) { pending.push('webview'); break; }
    } catch { /* not attached yet: dom-ready has not fired */
      pending.push('webview');
      break;
    }
  }
  return pending;
})()`;

const SETTLE_TIMEOUT_MS = 15_000;
const SETTLE_POLL_MS = 250;
// Lazy mounts can briefly leave nothing pending between two chunks; require
// consecutive clean polls instead of trusting a single one.
const SETTLE_CLEAN_POLLS = 2;

export async function waitForAppRendered(session, timeoutMs) {
  await waitFor(() => evaluateRenderer(session, APP_RENDERED_EXPRESSION), timeoutMs);
}

/** Resolves `{ settled: true }` or `{ settled: false, pending: [...] }`; never throws. */
export async function waitForContentSettled(session, {
  timeoutMs = SETTLE_TIMEOUT_MS,
  pollMs = SETTLE_POLL_MS,
  evaluate = evaluateRenderer,
} = {}) {
  const expression = pendingContentExpression();
  const started = Date.now();
  let clean = 0;
  let pending = [];
  while (Date.now() - started < timeoutMs) {
    try {
      pending = await evaluate(session, expression);
      clean = pending.length ? 0 : clean + 1;
      if (clean >= SETTLE_CLEAN_POLLS) return { settled: true };
    } catch {
      clean = 0; // renderer navigating or restarting; keep polling
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, pollMs));
  }
  return { settled: false, pending };
}
