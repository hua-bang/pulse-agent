import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PluginNodeData } from '../types';
import { createDefaultNode, createTodoListPluginNodePatch } from './nodeFactory';
import {
  MOCK_CARD_DEFAULT_PAYLOAD,
  MOCK_CARD_NODE_TYPE,
  MOCK_NODE_PLUGIN_ID,
  MOCK_TODO_LIST_DEFAULT_PAYLOAD,
  MOCK_TODO_LIST_NODE_TYPE,
} from '../../../plugins/mock-node/constants';
import { CANVAS_NODE_DEFAULTS, DEFAULT_TEXT_NODE_TITLES } from '../../../shared/canvas-node-defaults';
import { messages } from '../i18n/messages';

const useLanguage = (language: string) => {
  vi.stubGlobal('window', {
    localStorage: { getItem: () => language },
    navigator: { language },
  });
};

describe('createDefaultNode titles', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('keeps the shared English defaults for an English UI', () => {
    useLanguage('en');
    for (const type of Object.keys(CANVAS_NODE_DEFAULTS) as Array<keyof typeof CANVAS_NODE_DEFAULTS>) {
      expect(createDefaultNode(type, 0, 0).title).toBe(CANVAS_NODE_DEFAULTS[type].title);
    }
  });

  it('stores the title in Chinese when the UI is Chinese', () => {
    useLanguage('zh');
    expect(createDefaultNode('text', 0, 0).title).toBe('文本');
    expect(createDefaultNode('file', 0, 0).title).toBe('未命名');
  });

  it('lists every default text title that previews skip', () => {
    expect([...DEFAULT_TEXT_NODE_TITLES].sort()).toEqual(
      Object.values(messages).map((dict) => dict['canvas.nodeDefaultTitle.text']).sort(),
    );
  });
});

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
