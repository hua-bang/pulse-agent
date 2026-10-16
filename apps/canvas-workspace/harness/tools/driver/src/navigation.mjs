import { DEFAULT_TIMEOUT_MS } from './config.mjs';
import { evaluateRenderer } from './renderer.mjs';
import { waitFor } from './utils.mjs';

export async function applyStartupNavigation(session, opts) {
  if (opts.target === 'onboard') {
    await openOnboard(session);
    return;
  }
  if (opts.route) {
    await openRoute(session, opts.route);
  }
}

export function onboardHashRoute() {
  return '/?workspaceId=default';
}

// Inspect visible React output as well as the stored document. Background
// canvases stay mounted on other routes; their empty hints are not readiness.
export const ONBOARD_READY_EXPRESSION = `(${String(async function onboardReady() {
  // App consumes the workspace query after selecting it, then returns to #/.
  // The visible canvas ID below remains authoritative after that handoff.
  const isOnboardRoute = () => {
    const route = new URL(location.hash.slice(1), 'http://harness.local');
    return route.pathname === '/'
      && (!route.searchParams.has('workspaceId')
        || route.searchParams.get('workspaceId') === 'default')
      && !route.searchParams.has('nodeId');
  };
  const isVisible = (element) => {
    const rect = element.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0
      || rect.bottom <= 0 || rect.right <= 0
      || rect.top >= innerHeight || rect.left >= innerWidth) return false;
    for (let current = element; current; current = current.parentElement) {
      const style = getComputedStyle(current);
      if (current.hidden || style.display === 'none'
        || style.visibility === 'hidden' || style.visibility === 'collapse'
        || style.opacity === '0') return false;
    }
    return true;
  };
  const hasEmptyCanvas = () => {
    if (!isOnboardRoute()) return false;
    const canvases = [...document.querySelectorAll('.canvas-container')].filter(isVisible);
    if (canvases.length !== 1) return false;
    const canvas = canvases[0];
    if (canvas.getAttribute('data-canvas-id') !== 'default'
      || canvas.querySelector('[data-node-id]')) return false;
    const card = canvas.querySelector('.canvas-empty-card');
    if (!card || !isVisible(card)) return false;
    const actions = [...card.querySelectorAll('button.canvas-empty-action')];
    return actions.length === 3
      && actions.every((action) => isVisible(action) && !action.disabled);
  };
  if (!hasEmptyCanvas()) return false;
  const result = await window.canvasWorkspace.store.load('default');
  return result.ok === true
    && Array.isArray(result.data?.nodes) && result.data.nodes.length === 0
    && Array.isArray(result.data?.edges) && result.data.edges.length === 0
    && hasEmptyCanvas();
})})()`;

export async function openOnboard(session) {
  await openRoute(session, onboardHashRoute());
  await waitFor(
    () => evaluateRenderer(session, ONBOARD_READY_EXPRESSION),
    DEFAULT_TIMEOUT_MS,
  );
}

export async function openRoute(session, route) {
  const normalized = String(route).startsWith('/') ? String(route) : `/${route}`;
  await evaluateRenderer(session, `location.hash = ${JSON.stringify(`#${normalized}`)}; true`);
}
