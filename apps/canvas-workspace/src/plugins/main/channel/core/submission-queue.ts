export interface SubmissionReservation {
  previous: Promise<void>;
  release: () => void;
}

/** Orders submission, never model execution. Early command/failure releases
 * must still wait for their predecessors or later turns can jump the queue. */
export class SubmissionQueue {
  private readonly tails = new Map<string, Promise<void>>();

  reserve(key: string): SubmissionReservation {
    const previous = this.tails.get(key) ?? Promise.resolve();
    let release!: () => void;
    const released = new Promise<void>(resolve => { release = resolve; });
    const current = Promise.all([previous, released]).then(() => undefined);
    this.tails.set(key, current);
    void current.then(() => {
      if (this.tails.get(key) === current) this.tails.delete(key);
    });
    return { previous, release };
  }
}
