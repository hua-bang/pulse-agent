import { ReadingCapture } from './reading';
import { runPageReader } from './reader';
import { abortable, createBudget, waitForPage } from './budget';
import { PageRunRetry, PageRunStop, type PageAction, type PageRunInput, type PageRunPorts, type PageRunResult, type PageRunStatus, type PageSnapshot, type PageStep } from './types';

export function buildActions(snapshot: PageSnapshot): PageAction[] {
  const actions: PageAction[] = [];
  for (const target of snapshot.targets) {
    for (const kind of target.operations) {
      actions.push({ id: `${kind}_${target.ref}`, kind, target, description: `${kind}: ${target.role} ${target.name} (current value: ${target.value})${target.href ? ` -> ${target.href}` : ''}${target.linkTarget === '_blank' ? ' [opens another tab]' : ''}${target.requiresScroll ? ' [will reveal in scroll container first]' : ''}` });
    }
  }
  for (const area of snapshot.scrollAreas ?? []) {
    if (!area.atTop) actions.push({ id: `scroll_up_${area.ref}`, kind: 'scroll_up', scrollArea: area,
      description: `Scroll up inside region ${area.ref}: ${area.name}.` });
    if (!area.atBottom) actions.push({ id: `scroll_down_${area.ref}`, kind: 'scroll_down', scrollArea: area,
      description: `Scroll down inside region ${area.ref}: ${area.name}.` });
  }
  if (snapshot.scrollUp) actions.push({ id: 'scroll_up', kind: 'scroll_up', description: 'Scroll up one viewport.' });
  if (snapshot.scrollDown) actions.push({ id: 'scroll_down', kind: 'scroll_down', description: 'Scroll down one viewport.' });
  actions.push({ id: 'escape', kind: 'escape', description: 'Press Escape to dismiss a popup.' });
  actions.push({ id: 'wait', kind: 'wait', description: 'Briefly wait for submitted content or controls to load.' });
  return actions;
}

async function runInteractiveTask(input: PageRunInput, ports: PageRunPorts, parent?: AbortSignal): Promise<PageRunResult> {
  const started = Date.now();
  const budget = createBudget(input.timeoutMs, parent);
  const { signal } = budget;
  const steps: PageStep[] = [];
  const usage: PageRunResult['usage'] = { jevCalls: 0, inputTokens: 0, outputTokens: 0 };
  let page: PageSnapshot | undefined;
  const capture = new ReadingCapture();
  const reading = capture.value;
  let unchanged = 0;
  let stale = 0;
  const finish = (status: PageRunStatus, reason: string, errorCode?: string): PageRunResult => ({
    status, reason, verified: false, steps, usage, reading,
    ...(errorCode ? { errorCode } : {}),
    ...(ports.getOpenedPages?.().length ? { openedPages: ports.getOpenedPages() } : {}),
    finalUrl: page?.url,
    evidence: page ? { title: page.title, text: page.text.slice(0, 6_000),
      scroll: { top: page.scrollTop, height: page.viewportHeight, scrollHeight: page.scrollHeight,
        atTop: !page.scrollUp, atBottom: !page.scrollDown }, scrollAreas: page.scrollAreas ?? [] } : undefined,
    elapsedMs: Date.now() - started,
  });
  const call = <T>(fn: () => Promise<T>) => abortable(signal, fn);
  const observe = async () => {
    const snapshot = await call(() => ports.observe(signal));
    capture.add(snapshot, steps.length);
    return snapshot;
  };
  const handoff = () => finish('handoff', 'This action requested another tab. Use openedPages (or dock_list_tabs if its ID is still pending) to read or continue there; do not repeat the source-page click.');
  try {
    page = await observe();
    for (let step = 1; step <= input.maxSteps; step++) {
      if (ports.getOpenedPages?.().length) return handoff();
      const observed = page;
      const actions = buildActions(observed);
      const readingProgress = {
        snapshots: reading.entries.length,
        characters: reading.characters,
        truncated: reading.truncated,
        startedAtTop: reading.entries.find(entry => entry.url === observed.url)?.scrollUp === false,
      };
      const decision = await call(() => ports.decide(
        input.goal, { ...observed, readingProgress }, actions, steps.slice(-10), signal,
      ));
      usage.jevCalls++;
      usage.inputTokens += decision.inputTokens;
      usage.outputTokens += decision.outputTokens;
      usage.model = decision.model;
      if (ports.getOpenedPages?.().length) return handoff();
      const action = actions.find(candidate => candidate.id === decision.action);
      const record: PageStep = {
        step, proposed: decision.action, description: action?.description ?? decision.action,
        executed: false, outcome: 'not executed', confidence: decision.confidence,
        goalDone: decision.goalDone, stuck: decision.stuck, elapsedMs: Date.now() - started,
      };
      steps.push(record);

      if (!await call(() => ports.isFresh(observed, signal, action))) {
        record.outcome = 'page changed; re-observed without executing';
        if (++stale >= 3) return finish('blocked', 'Page repeatedly changed before execution.');
        page = await observe();
        continue;
      }
      if (decision.action === 'done') {
        record.outcome = 'model declared completion; independent verification required';
        return finish('model_done', record.outcome);
      }
      if (decision.action.startsWith('needs_input_')) {
        const target = observed.targets.find(item => item.ref === decision.action.slice('needs_input_'.length)
          && item.operations.includes('fill'));
        if (!target) throw new PageRunStop('error', 'Decision referenced an unavailable input field.', 'invalid_missing_field');
        record.outcome = `A value is needed for field ${JSON.stringify(target.name)} (${target.ref}); no input dispatched.`;
        return finish('needs_input', record.outcome, 'missing_field_value');
      }
      if (decision.action === 'unsupported') {
        record.outcome = 'The goal needs an interaction outside the offered browser capabilities. The main agent must choose another tool; this is not a request for missing user data.';
        return finish('unsupported', record.outcome, 'unsupported_interaction');
      }
      if (decision.action === 'blocked' || (step > 2 && decision.stuck > 0.85)) {
        return finish('blocked', 'Model reported no useful next action.');
      }
      if (!action) throw new PageRunStop('error', 'Decision referenced an unavailable action.');
      let text: string | undefined;
      if (action.kind === 'fill' && action.target) {
        text = await call(() => ports.text(input.goal, action.target!, observed, signal));
      }
      // Each concrete mutation is approved separately. Outer page_run approval is not inherited.
      if (action.kind !== 'wait' && !await call(() => ports.approve(action, text, step, signal))) {
        record.outcome = 'approval declined; no action executed';
        return finish('blocked', record.outcome);
      }
      if (!await call(() => ports.isFresh(observed, signal, action))) {
        record.outcome = 'page changed while preparing or approving; no action executed';
        if (++stale >= 3) return finish('blocked', 'Page repeatedly changed before execution.');
        page = await observe();
        continue;
      }
      record.outcome = 'preparing browser input';
      try {
        await call(() => ports.execute(action, observed, text, signal));
      } catch (error) {
        if (!signal.aborted && ports.getOpenedPages?.().length) {
          record.executed = true;
          record.outcome = 'new-tab request observed; input acknowledgement incomplete, not replayed';
          return handoff();
        }
        if (!signal.aborted && error instanceof PageRunRetry) {
          record.outcome = error.message;
          record.errorCode = error.code;
          if (++stale >= 3) return finish('blocked', 'Page repeatedly required recovery before input.', error.code);
          page = await observe();
          continue;
        }
        record.outcome = 'input failed or outcome uncertain; not replayed';
        if (error instanceof PageRunStop) record.errorCode = error.code;
        throw error;
      }
      stale = 0;
      record.executed = true;
      record.outcome = 'executed; observation pending';
      await (ports.settle ? ports.settle(signal) : waitForPage(signal));
      if (ports.getOpenedPages?.().length) {
        record.outcome = 'new-tab request observed; control returned to caller';
        return handoff();
      }
      page = await observe();
      const changed = page.fingerprint !== observed.fingerprint;
      record.outcome = changed ? 'page state changed' : 'no observed change';
      record.elapsedMs = Date.now() - started;
      unchanged = action.kind === 'wait' || changed ? 0 : unchanged + 1;
      if (unchanged >= 3) return finish('blocked', 'Three actions produced no observed progress.');
    }
    return finish('budget_exhausted', 'Browser task reached its step budget.');
  } catch (error) {
    const cause = signal.aborted ? signal.reason : error;
    return finish(cause instanceof PageRunStop ? cause.status : 'error',
      cause instanceof Error ? cause.message : 'Browser task failed.',
      cause instanceof PageRunStop ? cause.code : undefined);
  } finally {
    budget.dispose();
  }
}


export async function runPageTask(input: PageRunInput, ports: PageRunPorts, parent?: AbortSignal): Promise<PageRunResult> {
  const timings: NonNullable<PageRunResult['timings']> = { observe: 0, decide: 0, text: 0, approve: 0, execute: 0, isFresh: 0, settle: 0 };
  const measure = async <T>(name: keyof typeof timings, task: () => Promise<T>): Promise<T> => {
    const start = performance.now();
    try { return await task(); } finally { timings[name] += performance.now() - start; }
  };
  const measured: PageRunPorts = {
    ...ports,
    observe: (...args) => measure('observe', () => ports.observe(...args)),
    decide: (...args) => measure('decide', () => ports.decide(...args)),
    text: (...args) => measure('text', () => ports.text(...args)),
    approve: (...args) => measure('approve', () => ports.approve(...args)),
    execute: (...args) => measure('execute', () => ports.execute(...args)),
    isFresh: (...args) => measure('isFresh', () => ports.isFresh(...args)),
    settle: signal => measure('settle', () => ports.settle ? ports.settle(signal) : waitForPage(signal)),
  };
  const result = await (input.mode === 'read' ? runPageReader : runInteractiveTask)(input, measured, parent);
  return { ...result, timings };
}
