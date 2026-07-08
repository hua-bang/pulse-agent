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
  return '/?workspaceId=default&nodeId=node-welcome-note';
}

export async function openOnboard(session) {
  await openRoute(session, onboardHashRoute());
  await waitFor(
    async () => evaluateRenderer(
      session,
      [
        "document.body.innerText.includes('Welcome to Pulse Canvas')",
        "document.body.innerText.includes('欢迎使用 Pulse Canvas')",
        "document.body.innerText.includes('workspace for thinking with AI')",
        "document.body.innerText.includes('How to Begin')",
      ].join(' || '),
    ),
    DEFAULT_TIMEOUT_MS,
  );
}

export async function openRoute(session, route) {
  const normalized = String(route).startsWith('/') ? String(route) : `/${route}`;
  await evaluateRenderer(session, `location.hash = ${JSON.stringify(`#${normalized}`)}; true`);
}
