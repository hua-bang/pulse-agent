import { abortable, createBudget, waitForPage } from './budget';
import { ReadingCapture, pageEvidence } from './reading';
import { PageRunRetry, PageRunStop, type PageAction, type PageRunInput, type PageRunPorts,
  type PageRunResult, type PageRunStatus, type PageSnapshot, type PageDecision, type PageStep, type ReadingRegion } from './types';

export function readingActions(page: PageSnapshot): PageAction[] {
  // Include regions already at their end: selecting one still captures that view.
  return [
    ...(page.scrollAreas ?? []).map(area => ({ id: `scroll_down_${area.ref}`, kind: 'scroll_down' as const,
      scrollArea: area, description: `Read region ${area.ref}: ${area.name} from its current position to its bottom.` })),
    { id: 'scroll_down', kind: 'scroll_down', description: 'Read the document root from its current position to its bottom.' },
    { id: 'wait', kind: 'wait', description: 'Wait for the reading region to load.' },
  ];
}

function regionState(page: PageSnapshot, region: ReadingRegion) {
  if (page.documentId !== region.documentId || page.url !== region.url) {
    throw new PageRunStop('blocked', 'Document changed during reading; captured text is partial.', 'reading_document_changed');
  }
  const area = region.ref ? page.scrollAreas?.find(item => item.ref === region.ref) : undefined;
  if (page.readingRegionLost || (region.ref && (!area || area.signature !== region.signature))) return;
  return { top: area?.top ?? page.scrollTop ?? 0, height: area?.height ?? page.viewportHeight,
    extent: area?.scrollHeight ?? page.scrollHeight, bottom: area?.atBottom ?? !page.scrollDown };
}

/** A bounded scroll/collect controller; it cannot click, type, or follow links. */
export async function runPageReader(input: PageRunInput, ports: PageRunPorts, parent?: AbortSignal): Promise<PageRunResult> {
  const started = Date.now();
  const budget = createBudget(input.timeoutMs, parent);
  const { signal } = budget;
  const capture = new ReadingCapture();
  const steps: PageStep[] = [];
  const usage: PageRunResult['usage'] = { jevCalls: 0, inputTokens: 0, outputTokens: 0 };
  let page: PageSnapshot | undefined;
  let region: ReadingRegion | undefined;
  let recoveries = 0;
  let unchanged = 0;
  const call = <T>(fn: () => Promise<T>) => abortable(signal, fn);
  const settle = () => call(() => ports.settle ? ports.settle(signal) : waitForPage(signal));
  const observe = async (target?: ReadingRegion) => {
    const snapshot = await call(() => ports.observe(signal, target));
    // A loading placeholder is not captured as the next document view.
    if (!snapshot.loading && !snapshot.readingRegionLost) capture.add(snapshot, steps.length);
    return snapshot;
  };
  const finish = (status: PageRunStatus, reason: string, errorCode?: string): PageRunResult => ({
    status, reason, errorCode, verified: false, steps, usage, reading: capture.value,
    finalUrl: page?.url, evidence: pageEvidence(page), elapsedMs: Date.now() - started,
  });
  const reobserve = async () => {
    region = undefined;
    if (++recoveries >= 3) throw new PageRunStop('blocked', 'Reading region repeatedly changed; no uncertain action replayed.', 'reading_region_changed');
    return observe();
  };
  const capacityStop = () => finish('budget_exhausted',
    'Reading capture limit reached. Resume from this position; no further scrolling was performed.', 'reading_capacity');
  try {
    page = await observe();
    for (let step = 1; step <= input.maxSteps; step++) {
      if (capture.full || capture.value.truncated) return capacityStop();
      let decision: PageDecision | undefined;
      let action: PageAction | undefined;
      if (region) {
        if (!regionState(page, region)) { page = await reobserve(); continue; }
        action = readingActions(page).find(candidate => candidate.id === (region!.ref ? `scroll_down_${region!.ref}` : 'scroll_down'));
      } else {
        const actions = readingActions(page);
        decision = await call(() => ports.decide(
          `Select the main reading region for this goal: ${input.goal}. Read mode only collects from the current position to the bottom. Choose a scroll_down region (even if already at bottom), or wait/blocked/unsupported. The program handles traversal; do not choose done.`,
          { ...page!, targets: [], readingMode: true }, actions, steps.slice(-10), signal,
        ));
        usage.jevCalls++;
        usage.inputTokens += decision.inputTokens;
        usage.outputTokens += decision.outputTokens;
        usage.model = decision.model;
        action = actions.find(candidate => candidate.id === decision?.action);
      }
      const record: PageStep = {
        step, proposed: decision?.action ?? action?.id ?? 'unavailable',
        description: action?.description ?? decision?.action ?? 'Reading region unavailable',
        source: decision ? 'jev' : 'program', executed: false, outcome: 'not executed',
        ...(decision ? { confidence: decision.confidence, goalDone: decision.goalDone, stuck: decision.stuck } : {}),
        elapsedMs: Date.now() - started,
      };
      steps.push(record);
      if (!action) return finish(decision?.action === 'blocked' ? 'blocked' : 'unsupported',
        'Read mode requires a document region. Use act mode for semantic stopping, navigation or interaction.', 'reading_region_required');
      if (!await call(() => ports.isFresh(page!, signal, action))) {
        record.outcome = 'page changed before reading; re-observing';
        page = await reobserve();
        continue;
      }
      if (action.kind === 'scroll_down' && !region) {
        region = { documentId: page.documentId, url: page.url, ref: action.scrollArea?.ref, signature: action.scrollArea?.signature };
        // Capture only the selected region before its first scroll as well.
        page = await observe(region);
        if (!regionState(page, region)) { page = await reobserve(); continue; }
      }
      if (region && regionState(page, region)?.bottom && !page.loading) {
        const before = page;
        const position = regionState(before, region);
        await settle();
        page = await observe(region);
        const after = regionState(page, region);
        if (position && after?.bottom && !page.loading && before.text === page.text
          && position?.extent === after.extent && position.top === after.top && position.height === after.height) {
          if (capture.value.truncated) return capacityStop();
          record.outcome = 'observed stable region end; no scroll needed';
          return finish('read_complete', 'Selected region reached its observed bottom. Text is captured for the caller to read; media, embedded content and earlier positions are not verified.');
        }
        if (!after) { page = await reobserve(); continue; }
      }
      if (capture.full || capture.value.truncated) return capacityStop();
      if (page.loading) {
        record.outcome = 'reading region is loading; waited without scrolling';
        await settle();
        page = await observe(region);
        continue;
      }
      // Rebind position after every observation, including the end confirmation.
      action = readingActions(page).find(candidate => candidate.id === action!.id);
      if (!action) { page = await reobserve(); continue; }
      const observed = page;
      if (action.kind !== 'wait' && !await call(() => ports.approve(action!, undefined, step, signal))) {
        record.outcome = 'approval declined; no action executed';
        return finish('blocked', record.outcome);
      }
      if (!await call(() => ports.isFresh(observed, signal, action))) {
        record.outcome = 'page changed while approving; no action executed';
        page = await reobserve();
        continue;
      }
      try {
        await call(() => ports.execute(action!, observed, undefined, signal));
      } catch (error) {
        if (!signal.aborted && error instanceof PageRunRetry) {
          record.outcome = error.message;
          record.errorCode = error.code;
          page = await reobserve();
          continue;
        }
        record.outcome = 'input failed or outcome uncertain; not replayed';
        throw error;
      }
      record.executed = true;
      record.outcome = 'executed; observation pending';
      await settle();
      page = await observe(region);
      record.elapsedMs = Date.now() - started;
      if (region) {
        const before = regionState(observed, region);
        const after = regionState(page, region);
        if (!after) { page = await reobserve(); continue; }
        const changed = before?.top !== after.top || observed.text !== page.text || before?.extent !== after.extent;
        unchanged = changed || page.loading ? 0 : unchanged + 1;
        record.outcome = changed ? 'reading advanced' : 'no observed reading progress';
        if (unchanged >= 3) return finish('blocked', 'Three scrolls produced no reading progress.', 'reading_no_progress');
      }
      recoveries = 0;
    }
    return finish('budget_exhausted', 'Reading reached its step budget. Captured text and current position are retained for continuation.');
  } catch (error) {
    const cause = signal.aborted ? signal.reason : error;
    return finish(cause instanceof PageRunStop ? cause.status : 'error',
      cause instanceof Error ? cause.message : 'Reading failed.', cause instanceof PageRunStop ? cause.code : undefined);
  } finally {
    budget.dispose();
  }
}
