import type { CanvasNode, ShapeNodeData } from '../../../../shared/canvas';
import type { RawMindmapTopic } from '../types';
import { genTopicId } from '../../../../shared/canvas-node-defaults';
import { normalizeMindmapTopic } from './mindmap';

/** Shared construction data keeps approval previews identical to the created node. */
export const createPassiveNodeData = (
  type: 'text' | 'image' | 'shape' | 'mindmap',
  content: string,
  extra: Record<string, unknown>,
  requestedTitle?: string,
): CanvasNode['data'] => {
  switch (type) {
    case 'text':
      return {
        content,
        textColor: (extra.textColor as string) ?? '#1f2328',
        backgroundColor: (extra.backgroundColor as string) ?? 'transparent',
        fontSize: (extra.fontSize as number) ?? 18,
      };
    case 'image':
      return { filePath: typeof extra.filePath === 'string' ? extra.filePath : '' };
    case 'shape': {
      const validKinds: ShapeNodeData['kind'][] = ['rect', 'rounded-rect', 'ellipse', 'triangle', 'diamond', 'hexagon', 'star'];
      return {
        kind: validKinds.find(kind => kind === extra.kind) ?? 'rect',
        fill: (extra.fill as string) ?? '#E8EEF7',
        stroke: (extra.stroke as string) ?? '#5B7CBF',
        strokeWidth: (extra.strokeWidth as number) ?? 2,
        text: (extra.text as string) ?? (content || ''),
        textColor: extra.textColor as string | undefined,
        fontSize: extra.fontSize as number | undefined,
      };
    }
    case 'mindmap': {
      const rawRoot = extra.root as RawMindmapTopic | undefined;
      return {
        root: rawRoot
          ? normalizeMindmapTopic(rawRoot)
          : { id: genTopicId(), text: requestedTitle || 'Central topic', children: [] },
        layout: 'right',
        rev: 0,
      };
    }
  }
};
