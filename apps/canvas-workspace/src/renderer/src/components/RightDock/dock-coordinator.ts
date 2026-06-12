/**
 * Exclusivity coordinator for the right dock: at most one dock panel
 * (artifact preview, link preview, ...) is open at a time. A panel claims
 * the dock when it opens; claiming evicts the previous owner by invoking
 * its `onEvict` callback, which is expected to close that panel.
 *
 * Kept as a plain class (no React) so the policy is unit-testable and
 * reusable if docks ever appear in other windows.
 */

export interface DockClaim {
  id: string;
  /** Called when another panel claims the dock; owner should close itself. */
  onEvict: () => void;
}

export class DockCoordinator {
  private current: DockClaim | null = null;

  claim(claim: DockClaim): void {
    if (this.current && this.current.id !== claim.id) {
      this.current.onEvict();
    }
    this.current = claim;
  }

  /** No-op unless `id` is the current owner — a panel that was already
   * evicted must not release the claim of its successor. */
  release(id: string): void {
    if (this.current?.id === id) {
      this.current = null;
    }
  }

  get activeId(): string | null {
    return this.current?.id ?? null;
  }
}
