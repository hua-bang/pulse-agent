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
  MOCK_TODO_LIST_DEFAULT_PAYLOAD,
  MOCK_TODO_LIST_NODE_TYPE,
} from './constants';

type MockCardPayload = {
  text: string;
  count: number;
};

type TodoItem = {
  id: string;
  text: string;
  done: boolean;
};

type TodoListPayload = {
  title: string;
  items: TodoItem[];
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

function normalizeTodoItem(value: unknown, fallbackId: string): TodoItem | null {
  if (!isRecord(value)) return null;
  const text = typeof value.text === 'string' ? value.text.trim() : '';
  if (!text) return null;
  const id = typeof value.id === 'string' && value.id.trim()
    ? value.id.trim()
    : fallbackId;
  return {
    id,
    text,
    done: value.done === true,
  };
}

function readTodoPayload(ref: PluginNodeCapabilityRef): TodoListPayload {
  const data = ref.node.data as Record<string, unknown>;
  const payload = isRecord(data.payload) ? data.payload : {};
  const defaultItems = MOCK_TODO_LIST_DEFAULT_PAYLOAD.items.map((item) => ({ ...item }));
  const rawItems = Array.isArray(payload.items) ? payload.items : defaultItems;
  const items = rawItems
    .map((item, index) => normalizeTodoItem(item, `todo-${index + 1}`))
    .filter((item): item is TodoItem => item !== null);

  return {
    title: typeof payload.title === 'string' && payload.title.trim()
      ? payload.title.trim()
      : MOCK_TODO_LIST_DEFAULT_PAYLOAD.title,
    items,
  };
}

function normalizeTodoPayloadPatch(input: PluginNodeWriteInput): Record<string, unknown> {
  const patch = input.payload ?? {};
  const normalized: Record<string, unknown> = {};
  if (typeof patch.title === 'string') {
    normalized.title = patch.title.trim() || MOCK_TODO_LIST_DEFAULT_PAYLOAD.title;
  }
  if (Array.isArray(patch.items)) {
    normalized.items = patch.items
      .map((item, index) => normalizeTodoItem(item, `todo-${index + 1}`))
      .filter((item): item is TodoItem => item !== null);
  }
  return normalized;
}

function nextTodoItemId(items: TodoItem[]): string {
  const used = new Set(items.map((item) => item.id));
  let index = items.length + 1;
  while (used.has(`todo-${index}`)) index += 1;
  return `todo-${index}`;
}

function readTodoTargetId(input: Record<string, unknown>, items: TodoItem[]): string | null {
  if (typeof input.id === 'string' && input.id.trim()) return input.id.trim();
  if (typeof input.index === 'number' && Number.isInteger(input.index)) {
    const item = items[input.index];
    return item?.id ?? null;
  }
  return null;
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

    ctx.registerNodeCapabilities(MOCK_TODO_LIST_NODE_TYPE, {
      read(ref) {
        const payload = readTodoPayload(ref);
        const doneCount = payload.items.filter((item) => item.done).length;
        const openCount = payload.items.length - doneCount;
        return {
          content: [
            `${payload.title}`,
            `Open: ${openCount}, Done: ${doneCount}`,
            '',
            ...payload.items.map((item) => `- [${item.done ? 'x' : ' '}] ${item.text} (${item.id})`),
          ].join('\n'),
          payload,
          summary: `${payload.title}: ${openCount} open / ${doneCount} done`,
        };
      },
      write(_ref, input): PluginNodePatch {
        return {
          title: input.title,
          data: input.data,
          payload: normalizeTodoPayloadPatch(input),
        };
      },
      actions: {
        add_item(ref, input): PluginNodeActionResult {
          const payload = readTodoPayload(ref);
          const text = typeof input.text === 'string' ? input.text.trim() : '';
          if (!text) {
            return {
              result: {
                ok: false,
                error: 'text is required',
              },
            };
          }
          const item: TodoItem = {
            id: typeof input.id === 'string' && input.id.trim()
              ? input.id.trim()
              : nextTodoItemId(payload.items),
            text,
            done: input.done === true,
          };
          const items = [...payload.items, item];
          return {
            patch: {
              payload: { items },
            },
            result: {
              ok: true,
              item,
              total: items.length,
            },
          };
        },
        toggle_item(ref, input): PluginNodeActionResult {
          const payload = readTodoPayload(ref);
          const targetId = readTodoTargetId(input, payload.items);
          if (!targetId) {
            return {
              result: {
                ok: false,
                error: 'id or index is required',
              },
            };
          }

          let changed = false;
          const items = payload.items.map((item) => {
            if (item.id !== targetId) return item;
            changed = true;
            return {
              ...item,
              done: typeof input.done === 'boolean' ? input.done : !item.done,
            };
          });

          return {
            patch: changed ? { payload: { items } } : undefined,
            result: {
              ok: changed,
              id: targetId,
              item: items.find((item) => item.id === targetId) ?? null,
              error: changed ? undefined : 'item not found',
            },
          };
        },
        clear_completed(ref): PluginNodeActionResult {
          const payload = readTodoPayload(ref);
          const items = payload.items.filter((item) => !item.done);
          return {
            patch: {
              payload: { items },
            },
            result: {
              ok: true,
              removed: payload.items.length - items.length,
              total: items.length,
            },
          };
        },
      },
    });
  },
};
