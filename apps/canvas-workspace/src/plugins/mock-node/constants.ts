export const MOCK_NODE_PLUGIN_ID = 'mock';
export const MOCK_CARD_NODE_TYPE = 'mock.card';
export const MOCK_TODO_LIST_NODE_TYPE = 'mock.todo-list';
export const MOCK_NODE_REMOTE_NAME = 'pulse_canvas_mock_node';
export const MOCK_NODE_REMOTE_ENTRY = 'plugins/mock-node/remoteEntry.js';

export const MOCK_CARD_DEFAULT_PAYLOAD = {
  text: 'Hello from a plugin node',
  count: 0,
} as const;

export const MOCK_TODO_LIST_DEFAULT_PAYLOAD = {
  title: 'Todo List',
  items: [
    { id: 'todo-1', text: 'Sketch the first task', done: false },
    { id: 'todo-2', text: 'Wire read / write / action', done: true },
    { id: 'todo-3', text: 'Let the Agent operate the list', done: false },
  ],
} as const;
