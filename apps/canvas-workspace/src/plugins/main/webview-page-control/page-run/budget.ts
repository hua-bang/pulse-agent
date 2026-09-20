import { PageRunStop } from './types';

const deadlines = new WeakMap<AbortSignal, number>();

export function remainingBudget(signal: AbortSignal): number {
  return Math.max(0, (deadlines.get(signal) ?? Infinity) - Date.now());
}

export { abortable } from '../input-guard';

export function createBudget(timeoutMs: number, parent?: AbortSignal, timeoutError?: PageRunStop) {
  const controller = new AbortController();
  const effectiveMs = Math.min(timeoutMs, parent ? remainingBudget(parent) : Infinity);
  deadlines.set(controller.signal, Date.now() + effectiveMs);
  const cancel = () => controller.abort(parent?.reason instanceof PageRunStop
    ? parent.reason
    : new PageRunStop('cancelled', 'Browser task cancelled.'));
  const timer = setTimeout(() => controller.abort(parent?.aborted ? parent.reason
    : parent && remainingBudget(parent) <= 0
      ? new PageRunStop('budget_exhausted', 'Browser task reached its time budget.', 'run_timeout')
      : timeoutError ?? new PageRunStop('budget_exhausted', 'Browser task reached its time budget.', 'run_timeout'),
  ), effectiveMs);
  parent?.addEventListener('abort', cancel, { once: true });
  if (parent?.aborted) cancel();
  return {
    signal: controller.signal,
    dispose() {
      clearTimeout(timer);
      parent?.removeEventListener('abort', cancel);
      // Pending async continuations must not issue input after their owner returned.
      if (!controller.signal.aborted) controller.abort(new PageRunStop('cancelled', 'Browser task closed.'));
    },
  };
}

export function waitForPage(signal: AbortSignal, ms = 250): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(signal.reason);
    const aborted = () => { clearTimeout(timer); reject(signal.reason); };
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', aborted);
      resolve();
    }, ms);
    signal.addEventListener('abort', aborted, { once: true });
  });
}
