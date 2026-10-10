/**
 * Selection policy for L3 of the webview lifecycle ladder — Memory-Saver
 * style discard (see discard-monitor.ts for the runtime side).
 *
 * Mirrors Chrome's shape: discard is memory-pressure driven, not timer
 * driven. Only pages that are already frozen (L2 — i.e. long offscreen and
 * past the audible/DevTools exemptions) are candidates, and they are
 * discarded oldest-frozen-first until the projected total drops back under
 * budget. Kept free of Electron imports so the policy is unit-testable.
 */

export interface DiscardCandidate {
  /** `${workspaceId}::${nodeId}` — the registry key. */
  key: string;
  /** Guest process resident set size, MB. */
  rssMB: number;
  /** Set when the page is currently frozen (epoch ms); undefined = active. */
  frozenSinceMs?: number;
}

/**
 * Returns the registry keys to discard, oldest-frozen-first, so that the
 * projected total guest RSS falls at or below `budgetMB`. Never selects an
 * unfrozen page — if discarding every frozen page still leaves the total
 * over budget, the remainder is tolerated (matching Chrome, which never
 * discards the tabs you're using).
 */
export const selectWebviewsToDiscard = (
  candidates: DiscardCandidate[],
  budgetMB: number,
): string[] => {
  const total = candidates.reduce((sum, c) => sum + c.rssMB, 0);
  if (total <= budgetMB) return [];
  const frozen = [...candidates]
    .filter((c) => c.frozenSinceMs !== undefined)
    .sort((a, b) => (a.frozenSinceMs ?? 0) - (b.frozenSinceMs ?? 0));
  const selected: string[] = [];
  let projected = total;
  for (const candidate of frozen) {
    if (projected <= budgetMB) break;
    selected.push(candidate.key);
    projected -= candidate.rssMB;
  }
  return selected;
};
