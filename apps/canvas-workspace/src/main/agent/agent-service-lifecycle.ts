import type { CanvasAgentService } from './service';

// The service module pulls in the engine, tools, and session stores. It loads
// on the first agent call, so app startup does not parse it.
let service: Promise<CanvasAgentService> | null = null;
let loadedService: CanvasAgentService | null = null;
const pendingTeardowns = new Set<Promise<void>>();

export function getCanvasAgentService(): Promise<CanvasAgentService> {
  if (!service) {
    const loading: Promise<CanvasAgentService> = import('./service').then(({ CanvasAgentService }) => {
      const created = new CanvasAgentService();
      if (service === loading) loadedService = created;
      return created;
    });
    // A failed load is retried on the next call.
    loading.catch(() => {
      if (service === loading) service = null;
    });
    service = loading;
  }
  return service;
}

/** The current service if it has loaded. Agents exist only after it has. */
export function peekCanvasAgentService(): CanvasAgentService | null {
  return loadedService;
}

/** Retain earlier window-close drains while a reopened window owns a new service. */
export async function teardownCanvasAgentServices(): Promise<void> {
  const closing = service;
  service = null;
  loadedService = null;
  if (closing) {
    // A service that failed to load has nothing to deactivate.
    const pending = closing.then(closed => closed.deactivateAll(), () => undefined);
    pendingTeardowns.add(pending);
    void pending.then(
      () => pendingTeardowns.delete(pending),
      () => pendingTeardowns.delete(pending),
    );
  }
  let failure: PromiseRejectedResult | undefined;
  while (pendingTeardowns.size) {
    const results = await Promise.allSettled([...pendingTeardowns]);
    failure ??= results.find((result): result is PromiseRejectedResult => result.status === 'rejected');
  }
  if (failure) throw failure.reason;
}
