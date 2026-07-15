/**
 * Tracks the renderer mount that most recently claimed a PTY session.
 * Snapshot persistence can keep an old mount's cleanup alive after a new
 * mount has reused the same session id; only the latest lease may perform a
 * delayed, ownership-scoped kill.
 */
export class PtySessionLeaseRegistry {
  private generation = 0;
  private readonly leases = new Map<string, string>();

  claim(sessionId: string): string {
    const leaseId = String(++this.generation);
    this.leases.set(sessionId, leaseId);
    return leaseId;
  }

  release(sessionId: string, leaseId?: string): boolean {
    if (leaseId !== undefined && this.leases.get(sessionId) !== leaseId) return false;
    this.leases.delete(sessionId);
    return true;
  }
}
