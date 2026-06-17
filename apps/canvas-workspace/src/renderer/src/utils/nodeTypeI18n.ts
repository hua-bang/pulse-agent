import type { I18nKey } from '../i18n';
import type { CanvasNode } from '../types';

export const CANVAS_NODE_TYPE_LABEL_KEY: Record<CanvasNode['type'], I18nKey> = {
  file: 'node.type.file',
  terminal: 'node.type.terminal',
  frame: 'node.type.frame',
  group: 'node.type.group',
  agent: 'node.type.agent',
  text: 'node.type.text',
  iframe: 'node.type.iframe',
  image: 'node.type.image',
  shape: 'node.type.shape',
  mindmap: 'node.type.mindmap',
  reference: 'node.type.reference',
  'dynamic-app': 'node.type.dynamicApp',
  plugin: 'node.type.plugin',
};
