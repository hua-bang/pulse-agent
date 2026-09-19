import { CanvasAgentService } from './service';

let service: CanvasAgentService | null = null;
const pendingTeardowns = new Set<Promise<void>>();

export function getCanvasAgentService(): CanvasAgentService {
  if (!service) service = new CanvasAgentService();
  return service;
}

/** Retain earlier window-close drains while a reopened window owns a new service. */
export async function teardownCanvasAgentServices(): Promise<void> {
  const closing = service;
  service = null;
  if (closing) {
    const pending = Promise.resolve().then(() => closing.deactivateAll());
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
