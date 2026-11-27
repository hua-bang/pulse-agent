import './mobile.css';
import { resolveWebHostSession } from './authGate';
import { createWebWorkspaceApi } from './createWebWorkspaceApi';
import { mountMobileWebShell } from './mobileShell';
import { mountWebModelSettingsTrigger } from './modelSettings';
import { installMobileTouchBridge } from './touchBridge';

/**
 * Bootstrap the browser Web/H5 host when running outside Electron (`window.canvasWorkspace` absent).
 * Dynamically imported from `main.tsx` so Electron startup bundles pay zero extra bytes.
 */
export async function bootstrapWebHost(root: HTMLElement): Promise<void> {
  document.documentElement.dataset.pulseWeb = 'true';
  installMobileTouchBridge();
  const session = await resolveWebHostSession(root);
  const api = createWebWorkspaceApi(session);
  (window as unknown as { canvasWorkspace: typeof api }).canvasWorkspace = api;
  mountMobileWebShell(api, session);
  mountWebModelSettingsTrigger(session);
}
