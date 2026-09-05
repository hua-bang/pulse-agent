import type { BrowserWindow } from 'electron';

export interface RuntimeWindowActivation {
  ok: boolean;
  error?: string;
  window?: BrowserWindow;
}

export interface RuntimeWindowPort {
  activateWorkspaceWindow: (workspaceId: string) => Promise<RuntimeWindowActivation>;
}

let windowPort: RuntimeWindowPort | null = null;

export function setRuntimeWindowPort(port: RuntimeWindowPort): void {
  windowPort = port;
}

export function getRuntimeWindowPort(): RuntimeWindowPort {
  if (!windowPort) throw new Error('Runtime window integration is unavailable.');
  return windowPort;
}
