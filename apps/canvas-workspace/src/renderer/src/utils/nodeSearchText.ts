import type {
  CanvasNode,
  FileNodeData,
  IframeNodeData,
  MindmapNodeData,
  MindmapTopic,
  ShapeNodeData,
  TerminalNodeData,
  TextNodeData,
} from '../types';
import { htmlToPlainText } from './nodeLabel';

export interface NodeSearchText {
  text: string;
  lower: string;
}

const EMPTY: NodeSearchText = { text: '', lower: '' };

/**
 * Searchable text per data object. A node update replaces `data`, so an entry
 * stays valid for exactly as long as the content; unchanged nodes skip the
 * extraction on every keystroke.
 */
const cache = new WeakMap<object, NodeSearchText>();

const collectTopicText = (topic: MindmapTopic, out: string[]) => {
  if (topic.text) out.push(topic.text);
  for (const child of topic.children ?? []) collectTopicText(child, out);
};

const extract = (node: CanvasNode): string => {
  switch (node.type) {
    case 'file':
      // Tiptap stores HTML. A cheap tag strip is enough for the find bar;
      // inline highlighting lives in the note editor.
      return ((node.data as FileNodeData).content ?? '').replace(/<[^>]+>/g, ' ');
    case 'text':
      return htmlToPlainText((node.data as TextNodeData).content ?? '');
    case 'mindmap': {
      const root = (node.data as MindmapNodeData).root;
      const parts: string[] = [];
      if (root) collectTopicText(root, parts);
      return parts.join('\n');
    }
    case 'shape':
      return (node.data as ShapeNodeData).text ?? '';
    case 'iframe': {
      const data = node.data as IframeNodeData;
      return [data.pageTitle, data.url, data.prompt].filter(Boolean).join('\n');
    }
    case 'terminal':
      return [(node.data as TerminalNodeData).cwd, (node.data as TerminalNodeData).scrollback]
        .filter(Boolean)
        .join('\n');
    default:
      return '';
  }
};

/**
 * The content of a node that search matches against, apart from its title:
 * note and text bodies, every mind-map topic, shape text, a web page's title,
 * address, and prompt, and a terminal's folder and saved output.
 */
export const getNodeSearchText = (node: CanvasNode): NodeSearchText => {
  const data = node.data as object | undefined;
  if (!data || typeof data !== 'object') return EMPTY;
  let entry = cache.get(data);
  if (!entry) {
    const text = extract(node);
    entry = text ? { text, lower: text.toLowerCase() } : EMPTY;
    cache.set(data, entry);
  }
  return entry;
};
