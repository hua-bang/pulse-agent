import type { PluginNodeViewProps, RendererCanvasPlugin } from '../../types';
import './index.css';

type Payload = { text?: string; count?: number; title?: string; items?: TodoItem[] };
type TodoItem = { id: string; text: string; done: boolean };

const payloadOf = (props: PluginNodeViewProps): Payload => {
  const payload = (props.node.data as { payload?: unknown })?.payload;
  return payload && typeof payload === 'object' && !Array.isArray(payload) ? payload as Payload : {};
};

const updatePayload = (props: PluginNodeViewProps, payload: Payload): void => {
  props.updateNode({ data: { ...props.node.data, payload } });
};

const MockCardNodeView = (props: PluginNodeViewProps) => {
  const payload = payloadOf(props);
  const count = typeof payload.count === 'number' ? payload.count : 0;
  return (
    <div className="mock-node-card">
      <div><small>local plugin / mock.card</small><strong>{payload.text || 'Plugin node'}</strong></div>
      <div className="mock-node-card__actions">
        <span>count {count}</span>
        <button disabled={props.readOnly} onClick={() => updatePayload(props, { ...payload, count: count + 1 })}>Increment</button>
      </div>
    </div>
  );
};

const normalizeItems = (items: unknown): TodoItem[] => Array.isArray(items)
  ? items.filter((item): item is TodoItem => Boolean(item && typeof item === 'object' && typeof item.text === 'string'))
  : [];

const TodoListNodeView = (props: PluginNodeViewProps) => {
  const payload = payloadOf(props);
  const items = normalizeItems(payload.items);
  const setItems = (next: TodoItem[]) => updatePayload(props, { ...payload, items: next });
  return (
    <div className="mock-node-card mock-node-card--todo">
      <div><small>local plugin / mock.todo-list</small><strong>{payload.title || 'Todo List'}</strong></div>
      <div className="mock-node-card__list">
        {items.map((item) => (
          <button key={item.id} disabled={props.readOnly} onClick={() => setItems(items.map((entry) => entry.id === item.id ? { ...entry, done: !entry.done } : entry))}>
            {item.done ? '☑' : '☐'} {item.text}
          </button>
        ))}
      </div>
      <div className="mock-node-card__actions">
        <button disabled={props.readOnly} onClick={() => setItems([...items, { id: `todo-${Date.now()}`, text: `New task ${items.length + 1}`, done: false }])}>Add task</button>
        <button disabled={props.readOnly || !items.some((item) => item.done)} onClick={() => setItems(items.filter((item) => !item.done))}>Clear</button>
      </div>
    </div>
  );
};

export const MockNodeRendererPlugin: RendererCanvasPlugin = {
  id: 'mock',
  activate(ctx) {
    ctx.registerNodeView('mock.card', MockCardNodeView);
    ctx.registerNodeView('mock.todo-list', TodoListNodeView);
  },
};
