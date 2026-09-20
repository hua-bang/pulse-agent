import { randomUUID } from 'node:crypto';
import { getWebContentsForInstance, getWebviewRegistration } from '../../../../main/webview/registry';
import { withTemporarilyActiveWebview } from '../../../../main/webview/temporary-active-read';
import { observePageLinkRequests } from '../../../../main/webview/page-link-events';
import { getDockTabs } from '../../../../main/dock/tab-store';
import { cdpClickSelector, cdpFillSelector, cdpPressKey } from '../cdp-actions';
import { evaluateActionPolicy } from '../policy';
import { auditPageAction, resolvePageControlTarget } from '../target';
import { abortable, createBudget } from './budget';
import { snapshotScript } from './snapshot-script';
import { PageRunRetry, PageRunStop, type PageAction, type PageRunPorts, type PageSnapshot, type TargetInspection } from './types';

// Separate from both the untrusted page's main world and Electron's preload world (999).
const WORLD_ID = 987;
const activeGuests = new Set<number>();
type BrowserPorts = Pick<PageRunPorts, 'observe' | 'isFresh' | 'execute' | 'getOpenedPages'> & { close(): void };

export async function openPageRunBrowser(workspaceId: string, nodeId: string, signal: AbortSignal): Promise<BrowserPorts> {
  const resolved = await abortable(signal, () => resolvePageControlTarget(workspaceId, nodeId));
  if (!resolved.ok) throw new PageRunStop('blocked', resolved.error);
  const { wc } = resolved.target;
  const identity = getWebviewRegistration(wc.id);
  if (!identity) throw new PageRunStop('blocked', 'Target page is not registered.');
  if (activeGuests.has(wc.id)) throw new PageRunStop('blocked', 'Another page_run is already operating this page.');
  signal.throwIfAborted();
  activeGuests.add(wc.id);
  const runId = randomUUID();
  let closed = false;
  let trackingNavigation = false;
  const requestedLinks = new Set<string>();
  const unsubscribeLinks = observePageLinkRequests(identity, url => {
    if (trackingNavigation && !closed && requestedLinks.size < 5) requestedLinks.add(url);
  });
  const isCurrent = () => !closed && getWebContentsForInstance(identity) === wc;
  const assertLive = (currentSignal: AbortSignal) => {
    currentSignal.throwIfAborted();
    if (!isCurrent() || wc.isDestroyed()) throw new PageRunStop('blocked', 'Target page was closed or replaced.');
    const policy = evaluateActionPolicy(wc.getURL());
    if (!policy.allow) throw new PageRunStop('blocked', `Page policy blocked this operation: ${policy.reason}`);
  };
  const evaluate = async <T>(code: string, currentSignal: AbortSignal): Promise<T> => {
    assertLive(currentSignal);
    const result = await abortable(currentSignal, () => wc.executeJavaScriptInIsolatedWorld(WORLD_ID, [{ code }]) as Promise<T>);
    assertLive(currentSignal);
    return result;
  };
  const awake = async <T>(currentSignal: AbortSignal, task: () => Promise<T>): Promise<T> => {
    assertLive(currentSignal);
    return abortable(currentSignal, () => withTemporarilyActiveWebview(wc, wc.id, isCurrent, async () => {
      assertLive(currentSignal);
      return task();
    }));
  };
  return {
    observe: (currentSignal, reading) => awake(currentSignal, () => evaluate<PageSnapshot>(snapshotScript({ mode: 'observe', runId, reading }), currentSignal)),
    isFresh: (snapshot, currentSignal, action) => awake(currentSignal, () => evaluate<boolean>(snapshotScript({
      mode: action?.kind.startsWith('scroll_') ? 'scroll_fresh' : action ? 'action_fresh' : 'fresh',
      runId, snapshotId: snapshot.id, ref: action?.scrollArea?.ref ?? action?.target?.ref,
    }), currentSignal)),
    getOpenedPages: () => [...requestedLinks].map(url => {
      const tab = getDockTabs(workspaceId).find(item => item.kind === 'link' && item.url === url);
      return { workspaceId, url, ...(tab ? { nodeId: tab.id, title: tab.title } : {}) };
    }),
    async execute(action: PageAction, snapshot: PageSnapshot, text: string | undefined, parent: AbortSignal) {
      if (action.kind === 'wait') { assertLive(parent); return; }
      const budget = createBudget(5_000, parent, new PageRunStop(
        'error', 'Browser action exceeded its 5-second deadline; outcome may be uncertain. No automatic replay.', 'action_timeout',
      ));
      let first = true;
      let inputStarted = false;
      let lastStage = 'target preparation';
      let guardFailure: unknown;
      const requireReady = (inspection: TargetInspection) => {
        if (inspection.status === 'ready') return;
        const code = inspection.reason ?? 'target_unavailable';
        if (!inputStarted && ['stale', 'revealed', 'needs_scroll'].includes(inspection.status)) {
          throw new PageRunRetry(code, inspection.status === 'revealed'
            ? 'Scrolled to reveal the same target; re-observing before any click or typing.'
            : `Target needs a fresh observation (${code}); no click or typing dispatched.`);
        }
        throw new PageRunStop('blocked', `Browser target unavailable (${code})${inputStarted ? '; input may already have started, not replayed' : '; no click or typing dispatched'}.`, code);
      };
      const guard = {
        signal: budget.signal,
        beforeInput: async (method?: string, params?: Record<string, unknown>) => {
          try {
            assertLive(budget.signal);
            // Full snapshot before the first effect; later checks permit our own field/focus changes.
            if (action.target) {
              requireReady(await evaluate<TargetInspection>(snapshotScript({
                mode: 'inspect', runId, snapshotId: snapshot.id, ref: action.target.ref, strict: first,
                focused: method === 'Input.insertText' || method === 'Input.dispatchKeyEvent',
                point: method === 'Input.dispatchMouseEvent' && typeof params?.x === 'number' && typeof params.y === 'number'
                  ? { x: params.x, y: params.y } : undefined,
              }), budget.signal));
            } else {
              const valid = first ? await evaluate<boolean>(snapshotScript({ mode: 'action_fresh', runId, snapshotId: snapshot.id }), budget.signal)
                : wc.getURL() === snapshot.url;
              requireReady(valid ? { status: 'ready' } : { status: 'stale', reason: 'snapshot_changed' });
            }
            first = false;
          } catch (error) {
            // CDP primitives normalize errors into results; retain this cause for safe recovery.
            guardFailure = error;
            throw error;
          }
        },
        onInput: (method: string, params?: Record<string, unknown>) => {
          lastStage = `${method}${params?.type ? ` (${params.type})` : ''}`;
          if (method === 'DOM.fill' || method === 'Input.insertText'
            || (method === 'Input.dispatchMouseEvent' && params?.type === 'mousePressed')
            || (method === 'Input.dispatchKeyEvent' && ['keyDown', 'rawKeyDown'].includes(String(params?.type)))) inputStarted = true;
          if ((method === 'Input.dispatchMouseEvent' && params?.type === 'mousePressed')
            || (method === 'Input.dispatchKeyEvent' && params?.type === 'keyDown')) trackingNavigation = true;
        },
      };
      try {
        await awake(budget.signal, async () => {
          if (requestedLinks.size) throw new PageRunStop('handoff', 'A new tab was requested; do not repeat the click.');
          const selector = action.target ? `[data-pulse-run="${runId}:${action.target.ref}"]` : undefined;
          if (action.target) {
            requireReady(await evaluate<TargetInspection>(snapshotScript({
              mode: 'reveal', runId, snapshotId: snapshot.id, ref: action.target.ref, strict: true,
            }), budget.signal));
          }
          let result;
          if (action.kind === 'click' && selector) {
            result = await cdpClickSelector(wc, selector, guard);
          } else if (action.kind === 'fill' && selector && typeof text === 'string') {
            result = await cdpFillSelector(wc, selector, text, guard);
          } else if (action.kind === 'enter' || action.kind === 'escape') {
            result = await cdpPressKey(wc, action.kind === 'enter' ? 'Enter' : 'Escape', { ...guard, selector });
          } else if (action.kind === 'scroll_up' || action.kind === 'scroll_down') {
            await guard.beforeInput();
            budget.signal.throwIfAborted();
            inputStarted = true;
            lastStage = 'scrolling observed region';
            const scrolled = await evaluate<TargetInspection>(snapshotScript({
              mode: 'scroll', runId, snapshotId: snapshot.id, ref: action.scrollArea?.ref,
              direction: action.kind === 'scroll_down' ? 'down' : 'up',
            }), budget.signal);
            if (scrolled.status !== 'scrolled') {
              // The guest's atomic check rejected the operation before mutation.
              inputStarted = false;
              requireReady(scrolled);
            }
            result = { ok: true };
          } else {
            throw new PageRunStop('error', 'Unsupported browser action.');
          }
          auditPageAction('page_run', nodeId, wc.getURL(), { kind: action.kind, ok: result.ok });
          if (!result.ok) {
            if (guardFailure) throw guardFailure;
            if (result.timedOut) throw new PageRunStop('error', `Browser input timed out at ${lastStage}; no automatic replay.`, 'action_timeout');
            throw new PageRunStop('error', 'Browser input failed or its result is uncertain; no automatic retry.', 'input_failed');
          }
        });
      } catch (error) {
        if (budget.signal.aborted) {
          const cause = budget.signal.reason;
          if (cause instanceof PageRunStop && cause.code === 'action_timeout') {
            throw new PageRunStop('error', `${cause.message} Last stage: ${lastStage}.`, cause.code);
          }
          throw cause;
        }
        throw error;
      } finally {
        budget.dispose();
      }
    },
    close() {
      closed = true;
      unsubscribeLinks();
      activeGuests.delete(wc.id);
      // Do not wait on a destroyed/frozen guest. This cleanup can never perform user input.
      if (!wc.isDestroyed()) void wc.executeJavaScriptInIsolatedWorld(WORLD_ID, [{
        code: snapshotScript({ mode: 'cleanup', runId }),
      }]).catch(() => {});
    },
  };
}
