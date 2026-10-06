/** A renderer shows one approval at a time; other App calls wait for it. */
export class McpAppPendingApprovals<T> {
  private entries = new Map<number, { value?: T; released: Promise<void>; release: () => void }>();
  private waiters = new Map<number, number>();

  get(senderId: number): T | undefined { return this.entries.get(senderId)?.value; }

  set(senderId: number, value: T): void {
    const active = this.entries.get(senderId);
    if (active) {
      if (active.value !== undefined) throw new Error('MCP App approval is already active');
      active.value = value;
      return;
    }
    let release!: () => void;
    const released = new Promise<void>(resolve => { release = resolve; });
    this.entries.set(senderId, { value, released, release });
  }

  delete(senderId: number): void {
    const entry = this.entries.get(senderId);
    this.entries.delete(senderId);
    entry?.release();
  }

  async wait(senderId: number, isDestroyed: () => boolean): Promise<void> {
    const waiting = this.waiters.get(senderId) ?? 0;
    if (waiting >= 64) throw new Error('Too many queued MCP App approvals');
    this.waiters.set(senderId, waiting + 1);
    try {
      while (this.entries.has(senderId)) {
        if (isDestroyed()) throw new Error('MCP App renderer is closed');
        await this.entries.get(senderId)!.released;
      }
      if (isDestroyed()) throw new Error('MCP App renderer is closed');
      // Reserve synchronously before returning: only one resumed caller can
      // publish the next dialog, even when several awaited the same release.
      let release!: () => void;
      const released = new Promise<void>(resolve => { release = resolve; });
      this.entries.set(senderId, { released, release });
    } finally {
      const remaining = (this.waiters.get(senderId) ?? 1) - 1;
      if (remaining) this.waiters.set(senderId, remaining);
      else this.waiters.delete(senderId);
    }
  }
}
