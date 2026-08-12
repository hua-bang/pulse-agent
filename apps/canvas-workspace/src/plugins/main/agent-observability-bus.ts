import type {
  AgentObservabilitySubscriber,
  AgentTraceEvent,
} from '../../shared/agent-observability';

type LogError = (message: string, error: unknown) => void;

export class AgentObservabilityBus {
  private readonly subscribers = new Map<string, AgentObservabilitySubscriber>();
  private delivery: Promise<void> = Promise.resolve();

  constructor(
    private readonly logError: LogError = (message, error) => console.error(message, error),
  ) {}

  subscribe(subscriber: AgentObservabilitySubscriber): () => void {
    this.subscribers.set(subscriber.id, subscriber);
    return () => {
      if (this.subscribers.get(subscriber.id) === subscriber) {
        this.subscribers.delete(subscriber.id);
      }
    };
  }

  publish(event: AgentTraceEvent): void {
    const subscribers = [...this.subscribers.values()];
    this.delivery = this.delivery.then(async () => {
      for (const subscriber of subscribers) {
        try {
          await subscriber.onEvent(event);
        } catch (error) {
          this.logError(
            `[agent-observability] subscriber ${subscriber.id} rejected ${event.type}`,
            error,
          );
        }
      }
    });
  }

  async drain(): Promise<void> {
    await this.delivery;
  }

  async shutdown(): Promise<void> {
    await this.drain();
    const subscribers = [...this.subscribers.values()];
    this.subscribers.clear();
    await Promise.allSettled(subscribers.map(subscriber => subscriber.shutdown?.()));
  }
}
