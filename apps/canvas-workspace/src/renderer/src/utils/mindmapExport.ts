import type { CanvasNode, MindmapNodeData } from '../types';
import { layoutMindmap, type MindmapLayout, type LaidOutTopic } from './mindmapLayout';

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
  const toggleReserve = !isRoot && topic.hasChildren ? 12 : 0;
  const availableWidth = Math.max(1, topic.width - paddingX * 2 - toggleReserve);
  const lineHeight = fontSize * 1.3;
  const lines = isRoot
    ? [getTopicLabel(topic)]
    : wrapText(ctx, getTopicLabel(topic), availableWidth);

  ctx.save();
  ctx.fillStyle = '#1f2328';
  ctx.font = `${fontWeight} ${fontSize}px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`;
  ctx.textBaseline = 'middle';
  ctx.textAlign = isRoot ? 'center' : 'left';

  const totalTextHeight = lines.length * lineHeight;
  const firstLineY = topic.y + topic.height / 2 - totalTextHeight / 2 + lineHeight / 2;
  const x = isRoot ? topic.x + topic.width / 2 : topic.x + paddingX;

  lines.forEach((line, index) => {
    ctx.fillText(line, x, firstLineY + index * lineHeight, availableWidth);
  });

  if (!isRoot && topic.hasChildren) {
    ctx.beginPath();
    ctx.arc(topic.x + topic.width - 2, topic.y + topic.height / 2 + 3, 3, 0, Math.PI * 2);
    ctx.globalAlpha = topic.collapsed ? 0.9 : 0.18;
    ctx.fillStyle = topic.color;
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.strokeStyle = topic.color;
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  ctx.restore();
};

const wrapText = (ctx: CanvasRenderingContext2D, text: string, maxWidth: number) => {
  const sourceLines = text.split(/\r?\n/);
  const lines: string[] = [];

  for (const sourceLine of sourceLines) {
    const tokens = tokenizeLine(sourceLine);
    let line = '';
    for (const token of tokens) {
      const next = line ? `${line}${token}` : token.trimStart();
      if (line && ctx.measureText(next).width > maxWidth) {
        lines.push(line.trimEnd());
        line = token.trimStart();
      } else {
        line = next;
      }

      while (ctx.measureText(line).width > maxWidth && line.length > 1) {
        let cut = line.length - 1;
        while (cut > 1 && ctx.measureText(line.slice(0, cut)).width > maxWidth) cut--;
        lines.push(line.slice(0, cut));
        line = line.slice(cut);
      }
    }
    lines.push(line || ' ');
  }

  return lines;
};

const tokenizeLine = (line: string) => {
  const tokens: string[] = [];
  let current = '';
  for (const char of line) {
    current += char;
    if (/\s/.test(char)) {
      tokens.push(current);
      current = '';
    } else if (/[^\x00-\xff]/.test(char)) {
      tokens.push(current);
      current = '';
    }
  }
  if (current) tokens.push(current);
  return tokens.length > 0 ? tokens : [''];
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
