import { describe, expect, it } from 'vitest';
import type { PluginNodeData } from '../types';
import { createDefaultNode, createTodoListPluginNodePatch } from './nodeFactory';
import {
  MOCK_CARD_DEFAULT_PAYLOAD,
  MOCK_CARD_NODE_TYPE,
  MOCK_NODE_PLUGIN_ID,
  MOCK_TODO_LIST_DEFAULT_PAYLOAD,
  MOCK_TODO_LIST_NODE_TYPE,
} from '../../../plugins/mock-node/constants';

describe('createDefaultNode', () => {
  it('creates the first custom plugin node shell', () => {
    const node = createDefaultNode('plugin', 10, 20);
    const data = node.data as PluginNodeData;

    expect(node).toMatchObject({
      type: 'plugin',
      title: 'Plugin Node',
      x: 10,
      y: 20,
    });
    expect(data.pluginId).toBe(MOCK_NODE_PLUGIN_ID);
    expect(data.nodeType).toBe(MOCK_CARD_NODE_TYPE);
    expect(data.payload).toMatchObject(MOCK_CARD_DEFAULT_PAYLOAD);
  });

  it('creates a todo list plugin node patch', () => {
    const patch = createTodoListPluginNodePatch();
    const data = patch.data as PluginNodeData;

    expect(patch).toMatchObject({
      title: 'Todo List',
      width: 380,
      height: 320,
    });
    expect(data.pluginId).toBe(MOCK_NODE_PLUGIN_ID);
    expect(data.nodeType).toBe(MOCK_TODO_LIST_NODE_TYPE);
    expect(data.payload).toMatchObject(MOCK_TODO_LIST_DEFAULT_PAYLOAD);
  });
});
