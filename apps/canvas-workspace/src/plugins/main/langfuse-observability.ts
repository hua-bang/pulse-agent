import { LangfuseSpanProcessor } from '@langfuse/otel';
import {
  createTraceId,
  setLangfuseTracerProvider,
  startObservation,
  type LangfuseObservation,
} from '@langfuse/tracing';
import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node';
import type { MainCanvasPlugin } from '../types';
import {
  LangfuseAgentTraceSubscriber,
  type LangfuseObservationHandle,
  type LangfuseObservationKind,
  type LangfuseTraceAdapter,
} from './langfuse-agent-trace-subscriber';

const wrap = (observation: LangfuseObservation): LangfuseObservationHandle => ({
  end: timestamp => observation.end(timestamp),
  setAttributes: attributes => observation.otelSpan.setAttributes(attributes),
  spanContext: () => observation.otelSpan.spanContext(),
  update: attributes => observation.updateOtelSpanAttributes(attributes),
});

const createAdapter = (): LangfuseTraceAdapter => {
  const processor = new LangfuseSpanProcessor({
    publicKey: process.env.LANGFUSE_PUBLIC_KEY,
    secretKey: process.env.LANGFUSE_SECRET_KEY,
    baseUrl: process.env.LANGFUSE_BASE_URL,
    environment: process.env.LANGFUSE_TRACING_ENVIRONMENT,
    release: process.env.LANGFUSE_RELEASE,
    mediaUploadEnabled: false,
  });
  const provider = new NodeTracerProvider({ spanProcessors: [processor] });
  setLangfuseTracerProvider(provider);

  const start = (
    name: string,
    kind: LangfuseObservationKind,
    timestamp: Date,
    attributes: Record<string, unknown>,
    parentSpanContext: { traceId: string; spanId: string; traceFlags: number },
  ): LangfuseObservation => startObservation(name, attributes, {
    asType: kind,
    parentSpanContext,
    startTime: timestamp,
  } as never);

  return {
    async createRoot(runId, timestamp, metadata) {
      const traceId = await createTraceId(runId);
      return wrap(start('canvas.agent.turn', 'agent', timestamp, { metadata }, {
        traceId,
        spanId: '0123456789abcdef',
        traceFlags: 1,
      }));
    },
    start(parent, name, kind, timestamp, attributes = {}) {
      return wrap(start(name, kind, timestamp, attributes, parent.spanContext()));
    },
    async shutdown() {
      try {
        await provider.forceFlush();
      } finally {
        await provider.shutdown();
        setLangfuseTracerProvider(null);
      }
    },
  };
};

let unsubscribe: (() => void) | undefined;
let subscriber: LangfuseAgentTraceSubscriber | undefined;

export const LangfuseObservabilityMainPlugin: MainCanvasPlugin = {
  id: 'langfuse-observability',
  activate(ctx) {
    subscriber = new LangfuseAgentTraceSubscriber(createAdapter());
    unsubscribe = ctx.registerAgentObservabilitySubscriber(subscriber);
  },
  async deactivate() {
    unsubscribe?.();
    unsubscribe = undefined;
    await subscriber?.shutdown();
    subscriber = undefined;
  },
};
