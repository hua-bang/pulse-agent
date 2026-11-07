import type { CanvasNode, MindmapNodeData } from '../../../types';
import {
  layoutMindmap,
  MINDMAP_FONT_FAMILY as MINDMAP_EXPORT_FONT_FAMILY,
  wrapTopicLines,
  type MindmapLayout,
  type LaidOutTopic,
} from './layout';

const EXPORT_MARGIN = 28;
const EXPORT_SCALE = 2;

export interface MindmapImageExport {
  data: string;
  fileName: string;
  width: number;
  height: number;
}

const sanitizeFileName = (value: string) => {
  const trimmed = value
    .replace(/[\\/:*?"<>|]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return trimmed.length > 0 ? trimmed.slice(0, 80) : 'mindmap';
};

const getTopicLabel = (topic: LaidOutTopic) => topic.text.trim() || 'Untitled';

const drawTopic = (ctx: CanvasRenderingContext2D, topic: LaidOutTopic) => {
  const isRoot = topic.depth === 0;
  const fontSize = isRoot ? 20 : 14;
  const fontWeight = isRoot ? 500 : 400;
  const paddingX = isRoot ? 13 : 11;
  const availableWidth = Math.max(1, topic.width - paddingX * 2);
  const lineHeight = fontSize * 1.3;
  const lines = isRoot
    ? [getTopicLabel(topic)]
    : wrapTopicLines(getTopicLabel(topic), availableWidth);

  ctx.save();
  ctx.fillStyle = '#1f2328';
  ctx.font = `${fontWeight} ${fontSize}px ${MINDMAP_EXPORT_FONT_FAMILY}`;
  ctx.textBaseline = 'middle';
  ctx.textAlign = isRoot ? 'center' : 'left';

  const totalTextHeight = lines.length * lineHeight;
  const firstLineY = topic.y + topic.height / 2 - totalTextHeight / 2 + lineHeight / 2;
  const x = isRoot ? topic.x + topic.width / 2 : topic.x + paddingX;

  lines.forEach((line, index) => {
    ctx.fillText(line, x, firstLineY + index * lineHeight, availableWidth);
  });

  // Like the canvas, only a collapsed topic shows its dot, just past the text.
  if (!isRoot && topic.hasChildren && topic.collapsed) {
    ctx.beginPath();
    ctx.arc(topic.x + topic.width + 6, topic.y + topic.height / 2, 3, 0, Math.PI * 2);
    ctx.globalAlpha = 0.9;
    ctx.fillStyle = topic.color;
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.strokeStyle = topic.color;
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  ctx.restore();
};

const drawBranches = (ctx: CanvasRenderingContext2D, layout: MindmapLayout) => {
  const topics = new Map(layout.topics.map((topic) => [topic.id, topic]));

  for (const branch of layout.branches) {
    const parent = topics.get(branch.parentId);
    const child = topics.get(branch.childId);
    if (!parent || !child) continue;

    const startX = parent.x + parent.width;
    const startY = parent.y + parent.height / 2;
    const endX = child.x;
    const endY = child.y + child.height / 2;
    const midX = startX + (endX - startX) / 2;

    ctx.beginPath();
    ctx.moveTo(startX, startY);
    ctx.bezierCurveTo(midX, startY, midX, endY, endX, endY);
    ctx.strokeStyle = branch.color;
    ctx.globalAlpha = 0.85;
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.stroke();
    ctx.globalAlpha = 1;
  }
};

export const exportMindmapNodeToPng = async (node: CanvasNode): Promise<MindmapImageExport> => {
  if (document.fonts) {
    await Promise.all([
      document.fonts.load(`400 14px ${MINDMAP_EXPORT_FONT_FAMILY}`, 'Aa 中文'),
      document.fonts.load(`500 20px ${MINDMAP_EXPORT_FONT_FAMILY}`, 'Aa 中文'),
    ]);
  }

  const data = node.data as MindmapNodeData;
  const layout = layoutMindmap(data.root);
  const width = Math.ceil(layout.width + EXPORT_MARGIN * 2);
  const height = Math.ceil(layout.height + EXPORT_MARGIN * 2);

  const canvas = document.createElement('canvas');
  canvas.width = width * EXPORT_SCALE;
  canvas.height = height * EXPORT_SCALE;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas rendering is unavailable.');

  ctx.scale(EXPORT_SCALE, EXPORT_SCALE);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);
  ctx.translate(EXPORT_MARGIN, EXPORT_MARGIN);
  drawBranches(ctx, layout);
  layout.topics.forEach((topic) => drawTopic(ctx, topic));

  const dataUrl = canvas.toDataURL('image/png');
  const base64 = dataUrl.split(',')[1];
  if (!base64) throw new Error('Failed to encode exported image.');

  const name = sanitizeFileName(node.title || data.root.text || 'mindmap');
  return {
    data: base64,
    fileName: `${name}.png`,
    width,
    height,
  };
};
