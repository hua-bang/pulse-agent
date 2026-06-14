import type {
  MainCanvasPlugin,
  PluginNodeActionResult,
  PluginNodeCapabilityRef,
  PluginNodePatch,
  PluginNodeWriteInput,
} from '../types';
import {
  MOCK_CARD_DEFAULT_PAYLOAD,
  MOCK_CARD_NODE_TYPE,
  MOCK_NODE_PLUGIN_ID,
} from './constants';

type MockCardPayload = {
  text: string;
  count: number;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function readPayload(ref: PluginNodeCapabilityRef): MockCardPayload {
  const data = ref.node.data as Record<string, unknown>;
  const payload = isRecord(data.payload) ? data.payload : {};
  return {
    text: typeof payload.text === 'string'
      ? payload.text
      : MOCK_CARD_DEFAULT_PAYLOAD.text,
    count: typeof payload.count === 'number'
      ? payload.count
      : MOCK_CARD_DEFAULT_PAYLOAD.count,
  };
}

function normalizePayloadPatch(input: PluginNodeWriteInput): Record<string, unknown> {
  const patch = input.payload ?? {};
  const normalized: Record<string, unknown> = {};
  if (typeof patch.text === 'string') normalized.text = patch.text;
  if (typeof patch.count === 'number' && Number.isFinite(patch.count)) {
    normalized.count = patch.count;
  }
  return normalized;
}

function readAmount(input: Record<string, unknown>): number {
  const raw = input.amount;
  return typeof raw === 'number' && Number.isFinite(raw) ? raw : 1;
}

export const MockNodeMainPlugin: MainCanvasPlugin = {
  id: MOCK_NODE_PLUGIN_ID,
  activate(ctx) {
    ctx.registerNodeCapabilities(MOCK_CARD_NODE_TYPE, {
      read(ref) {
        const payload = readPayload(ref);
        return {
          content: [
            `Mock card: ${payload.text}`,
            `Count: ${payload.count}`,
            '',
            'This custom node is backed by a main-side read/write/action capability provider.',
          ].join('\n'),
          payload,
          summary: `${payload.text} (count ${payload.count})`,
        };
      },
      write(_ref, input): PluginNodePatch {
        return {
          title: input.title,
          data: input.data,
          payload: normalizePayloadPatch(input),
        };
      },
      actions: {
        increment(ref, input): PluginNodeActionResult {
          const payload = readPayload(ref);
          const amount = readAmount(input);
          const nextCount = payload.count + amount;
          return {
            patch: {
              payload: {
                count: nextCount,
              },
            },
            result: {
              count: nextCount,
              amount,
            },
          };
        },
      },
    });
  },
};
