import type {
  ExcalidrawBoardPayload,
  ExcalidrawBoardScene,
  ExcalidrawElementRecord,
  ExcalidrawSceneSummary,
  ExcalidrawSkeletonElement,
  ExcalidrawSkeletonType,
} from './types';

const DEFAULT_TITLE = 'Excalidraw Board';
const DEFAULT_BACKGROUND = '#ffffff';
const DEFAULT_STROKE = '#1e1e1e';
const DEFAULT_FILL = 'transparent';
const TEXT_HORIZONTAL_PADDING = 40;
const TEXT_VERTICAL_PADDING = 28;

let elementCounter = 0;

export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function finiteNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function stringValue(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

function now(): number {
  return Date.now();
}

function hashToInt(value: string): number {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = ((hash << 5) - hash + value.charCodeAt(index)) | 0;
  }
  return Math.abs(hash) || 1;
}

function nextId(prefix = 'pcn'): string {
  elementCounter += 1;
  return `${prefix}-${Date.now().toString(36)}-${elementCounter}`;
}

function safeType(value: unknown): ExcalidrawSkeletonType {
  return value === 'ellipse' ||
    value === 'diamond' ||
    value === 'text' ||
    value === 'arrow' ||
    value === 'line'
    ? value
    : 'rectangle';
}

function isWideTextChar(char: string): boolean {
  return /[^\u0000-\u00ff]/.test(char);
}

function estimateLineWidth(line: string, fontSize: number): number {
  let width = 0;
  for (const char of line) {
    width += fontSize * (isWideTextChar(char) ? 1.08 : 0.6);
  }
  return width;
}

function estimateTextSize(text: string, fontSize: number, lineHeight: number): { width: number; height: number } {
  const lines = text.split('\n');
  const longestLineWidth = Math.max(0, ...lines.map((line) => estimateLineWidth(line, fontSize)));
  return {
    width: Math.max(80, Math.ceil(longestLineWidth)),
    height: Math.ceil(fontSize * lineHeight * Math.max(1, lines.length)),
  };
}

function normalizeAppState(value: unknown): Record<string, unknown> {
  const raw = isRecord(value) ? value : {};
  const out: Record<string, unknown> = {
    viewBackgroundColor: typeof raw.viewBackgroundColor === 'string'
      ? raw.viewBackgroundColor
      : DEFAULT_BACKGROUND,
  };
  for (const key of [
    'gridModeEnabled',
    'theme',
    'name',
    'currentItemStrokeColor',
    'currentItemBackgroundColor',
    'currentItemFillStyle',
    'currentItemStrokeWidth',
    'currentItemStrokeStyle',
    'currentItemRoughness',
    'currentItemOpacity',
    'currentItemFontFamily',
    'currentItemFontSize',
  ]) {
    if (raw[key] !== undefined && typeof raw[key] !== 'function') {
      out[key] = raw[key];
    }
  }
  return out;
}

function normalizeFiles(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

export function normalizeElements(value: unknown): ExcalidrawElementRecord[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter(isRecord)
    .map((element) => ({ ...element }));
}

export function normalizeBoardPayload(value: unknown): ExcalidrawBoardScene {
  const payload = isRecord(value) ? value as ExcalidrawBoardPayload : {};
  return {
    title: stringValue(payload.title, DEFAULT_TITLE),
    elements: normalizeElements(payload.elements),
    appState: normalizeAppState(payload.appState),
    files: normalizeFiles(payload.files),
    updatedAt: typeof payload.updatedAt === 'string' ? payload.updatedAt : undefined,
  };
}

function baseElement(
  skeleton: ExcalidrawSkeletonElement,
  type: string,
): ExcalidrawElementRecord {
  const id = stringValue(skeleton.id, nextId(type));
  return {
    id,
    type,
    x: finiteNumber(skeleton.x, 80),
    y: finiteNumber(skeleton.y, 80),
    width: finiteNumber(skeleton.width, type === 'text' ? 160 : 180),
    height: finiteNumber(skeleton.height, type === 'text' ? 32 : 96),
    angle: 0,
    strokeColor: stringValue(skeleton.strokeColor, DEFAULT_STROKE),
    backgroundColor: stringValue(skeleton.backgroundColor, DEFAULT_FILL),
    fillStyle: 'solid',
    strokeWidth: finiteNumber(skeleton.strokeWidth, 2),
    strokeStyle: 'solid',
    roughness: finiteNumber(skeleton.roughness, 1),
    opacity: finiteNumber(skeleton.opacity, 100),
    groupIds: [],
    frameId: null,
    roundness: type === 'rectangle' ? { type: 3 } : null,
    seed: hashToInt(id),
    version: 1,
    versionNonce: hashToInt(`${id}:nonce`),
    isDeleted: false,
    boundElements: null,
    updated: now(),
    link: null,
    locked: false,
  };
}

function textElement(
  skeleton: ExcalidrawSkeletonElement,
  options: { idPrefix?: string; centerIn?: ExcalidrawElementRecord } = {},
): ExcalidrawElementRecord {
  const text = typeof skeleton.text === 'string' ? skeleton.text : '';
  const fontSize = finiteNumber(skeleton.fontSize, 20);
  const lineHeight = 1.25;
  const fallbackSize = estimateTextSize(text, fontSize, lineHeight);
  const id = stringValue(skeleton.id, nextId(options.idPrefix ?? 'text'));
  const center = options.centerIn;
  const width = finiteNumber(skeleton.width, center
    ? Math.max(32, Number(center.width) - TEXT_HORIZONTAL_PADDING)
    : fallbackSize.width);
  const height = finiteNumber(skeleton.height, center
    ? Math.max(fallbackSize.height, Number(center.height) - TEXT_VERTICAL_PADDING)
    : fallbackSize.height);
  const x = center
    ? finiteNumber(center.x, 80) + (finiteNumber(center.width, 180) - width) / 2
    : finiteNumber(skeleton.x, 80);
  const y = center
    ? finiteNumber(center.y, 80) + (finiteNumber(center.height, 96) - height) / 2
    : finiteNumber(skeleton.y, 80);

  return {
    ...baseElement({ ...skeleton, id, x, y, width, height }, 'text'),
    text,
    originalText: text,
    fontSize,
    fontFamily: 1,
    textAlign: center ? 'center' : 'left',
    verticalAlign: center ? 'middle' : 'top',
    baseline: Math.ceil(fontSize * 0.9),
    lineHeight,
    containerId: null,
  };
}

function linearElement(skeleton: ExcalidrawSkeletonElement, type: 'arrow' | 'line'): ExcalidrawElementRecord {
  const width = finiteNumber(skeleton.width, 160);
  const height = finiteNumber(skeleton.height, 0);
  return {
    ...baseElement({ ...skeleton, width, height }, type),
    points: [[0, 0], [width, height]],
    lastCommittedPoint: null,
    startBinding: null,
    endBinding: null,
    startArrowhead: null,
    endArrowhead: type === 'arrow' ? 'arrow' : null,
  };
}

export function skeletonToElements(value: unknown): ExcalidrawElementRecord[] {
  if (!Array.isArray(value)) return [];
  const elements: ExcalidrawElementRecord[] = [];

  for (const item of value) {
    if (!isRecord(item)) continue;
    const skeleton = item as unknown as ExcalidrawSkeletonElement;
    const type = safeType(skeleton.type);

    if (type === 'text') {
      elements.push(textElement(skeleton));
      continue;
    }

    if (type === 'arrow' || type === 'line') {
      const line = linearElement(skeleton, type);
      elements.push(line);
      if (typeof skeleton.text === 'string' && skeleton.text.trim()) {
        elements.push(textElement({
          type: 'text',
          text: skeleton.text,
          x: finiteNumber(line.x, 80) + finiteNumber(line.width, 160) / 2 - 50,
          y: finiteNumber(line.y, 80) + finiteNumber(line.height, 0) / 2 - 24,
          width: 100,
          height: 28,
          fontSize: finiteNumber(skeleton.fontSize, 16),
          strokeColor: skeleton.strokeColor,
        }, { idPrefix: 'label' }));
      }
      continue;
    }

    const shape = baseElement(skeleton, type);
    elements.push(shape);
    if (typeof skeleton.text === 'string' && skeleton.text.trim()) {
      elements.push(textElement({
        type: 'text',
        text: skeleton.text,
        fontSize: skeleton.fontSize,
        strokeColor: skeleton.strokeColor,
      }, { idPrefix: 'label', centerIn: shape }));
    }
  }

  return elements;
}

export function elementsFromSceneInput(input: Record<string, unknown>): ExcalidrawElementRecord[] {
  const skeletonElements = skeletonToElements(input.skeleton);
  if (skeletonElements.length > 0) return skeletonElements;
  return normalizeElements(input.elements);
}

export function applySceneInput(
  current: ExcalidrawBoardScene,
  input: Record<string, unknown>,
  mode: 'replace' | 'append',
): ExcalidrawBoardScene {
  const nextElements = elementsFromSceneInput(input);
  const appStatePatch = normalizeAppState(input.appState);
  const backgroundColor = typeof input.backgroundColor === 'string' && input.backgroundColor.trim()
    ? input.backgroundColor.trim()
    : undefined;

  return {
    title: stringValue(input.title, current.title),
    elements: mode === 'append' ? [...current.elements, ...nextElements] : nextElements,
    appState: {
      ...current.appState,
      ...appStatePatch,
      ...(backgroundColor ? { viewBackgroundColor: backgroundColor } : {}),
    },
    files: {
      ...current.files,
      ...normalizeFiles(input.files),
    },
    updatedAt: new Date().toISOString(),
  };
}

export function scenePatch(scene: ExcalidrawBoardScene): { payload: ExcalidrawBoardPayload } {
  return {
    payload: {
      title: scene.title,
      elements: scene.elements,
      appState: scene.appState,
      files: scene.files,
      updatedAt: scene.updatedAt,
    },
  };
}

export function summarizeScene(scene: ExcalidrawBoardScene): ExcalidrawSceneSummary {
  const countsByType: Record<string, number> = {};
  const texts: string[] = [];

  for (const element of scene.elements) {
    const type = typeof element.type === 'string' ? element.type : 'unknown';
    countsByType[type] = (countsByType[type] ?? 0) + 1;
    if (typeof element.text === 'string' && element.text.trim()) {
      texts.push(element.text.trim());
    }
  }

  return {
    title: scene.title,
    elementCount: scene.elements.length,
    textCount: texts.length,
    texts,
    countsByType,
  };
}

export function sceneContent(scene: ExcalidrawBoardScene): string {
  const summary = summarizeScene(scene);
  const counts = Object.entries(summary.countsByType)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([type, count]) => `${type}: ${count}`)
    .join(', ');
  return [
    `Excalidraw board: ${summary.title}`,
    `Elements: ${summary.elementCount}${counts ? ` (${counts})` : ''}`,
    summary.texts.length ? 'Text labels:' : 'Text labels: none',
    ...summary.texts.map((text) => `- ${text}`),
  ].join('\n');
}
