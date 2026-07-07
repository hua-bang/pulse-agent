import type { CanvasNode } from './storage';
import type {
  WelcomeContent,
  WelcomeMindmapTopicContent,
  WelcomeNoteContent,
  WelcomeTextContent,
} from './welcome-content-types';

/**
 * Geometry + node assembly for the seeded onboarding canvas.
 *
 * Five frames laid out left to right as a progressive course:
 * 01 Welcome → 02 Canvas basics → 03 Organize → 04 Work with AI → 05 Power
 * workflow. Copy comes from the locale content modules; this file owns
 * coordinates, node ids, and node data shapes only. Frames contain nodes
 * spatially (no parent pointers), so every child rect must stay inside its
 * frame rect.
 */

export type WelcomeNoteKey = keyof WelcomeContent['notes'];

/** Absolute markdown file path for each seeded note, resolved by the seeder. */
export type WelcomeNotePaths = Record<WelcomeNoteKey, string>;

export interface WelcomeCanvasBuild {
  nodes: CanvasNode[];
  edges: unknown[];
}

/** Landing transform: shows frame 01 (the welcome zone) comfortably. */
export const WELCOME_TRANSFORM = { x: 90, y: 40, scale: 0.55 };

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

const FRAME_COLORS: Record<keyof WelcomeContent['frames'], string> = {
  welcome: 'oklch(0.68 0.108 224)',
  basics: 'oklch(0.70 0.120 150)',
  organize: 'oklch(0.65 0.120 300)',
  ai: 'oklch(0.72 0.130 60)',
  advanced: 'oklch(0.70 0.110 200)',
};

const mkFrame = (
  id: string,
  title: string,
  rect: Rect,
  color: string,
  now: number,
): CanvasNode => ({
  id,
  type: 'frame',
  title,
  ...rect,
  data: { color },
  updatedAt: now,
});

const mkNote = (
  id: string,
  note: WelcomeNoteContent,
  filePath: string,
  rect: Rect,
  now: number,
): CanvasNode => ({
  id,
  type: 'file',
  title: note.title,
  ...rect,
  data: { filePath, content: note.content, saved: true, modified: false },
  updatedAt: now,
});

const mkText = (
  id: string,
  text: WelcomeTextContent,
  rect: Rect,
  now: number,
  opts: { backgroundColor?: string; fontSize?: number } = {},
): CanvasNode => ({
  id,
  type: 'text',
  title: text.title,
  ...rect,
  data: {
    content: text.content,
    textColor: '#1f2328',
    backgroundColor: opts.backgroundColor ?? 'transparent',
    fontSize: opts.fontSize ?? 18,
    autoSize: false,
  },
  updatedAt: now,
});

const mkUrlIframe = (
  id: string,
  title: string,
  url: string,
  rect: Rect,
  now: number,
): CanvasNode => ({
  id,
  type: 'iframe',
  title,
  ...rect,
  data: { url, html: '', mode: 'url', prompt: '' },
  updatedAt: now,
});

const mkHtmlIframe = (
  id: string,
  title: string,
  html: string,
  rect: Rect,
  now: number,
): CanvasNode => ({
  id,
  type: 'iframe',
  title,
  ...rect,
  data: { url: '', html, mode: 'html', prompt: '' },
  updatedAt: now,
});

const toMindmapTopic = (
  topic: WelcomeMindmapTopicContent,
  id: string,
): { id: string; text: string; children: unknown[] } => ({
  id,
  text: topic.text,
  children: (topic.children ?? []).map((child, index) => toMindmapTopic(child, `${id}-${index}`)),
});

export function buildWelcomeCanvas(
  content: WelcomeContent,
  notePaths: WelcomeNotePaths,
  now: number,
): WelcomeCanvasBuild {
  const { frames, notes, texts, shape, iframes, mindmap, edges } = content;

  const nodes: CanvasNode[] = [
    // ---- 01 · Welcome -----------------------------------------------------
    mkFrame('node-onboard-frame-01', frames.welcome, { x: 0, y: 0, width: 1500, height: 1080 }, FRAME_COLORS.welcome, now),
    mkHtmlIframe('node-onboard-slogan', iframes.slogan.title, iframes.slogan.html, { x: 60, y: 100, width: 660, height: 260 }, now),
    mkNote('node-welcome-note', notes.welcome, notePaths.welcome, { x: 60, y: 420, width: 660, height: 560 }, now),
    mkUrlIframe('node-welcome-download', iframes.download.title, iframes.download.url, { x: 790, y: 100, width: 650, height: 700 }, now),
    mkText('node-onboard-guide', texts.guide, { x: 790, y: 860, width: 500, height: 140 }, now, { fontSize: 24 }),

    // ---- 02 · Canvas basics ----------------------------------------------
    mkFrame('node-onboard-frame-02', frames.basics, { x: 1650, y: 0, width: 1560, height: 1080 }, FRAME_COLORS.basics, now),
    mkText('node-onboard-practice-text', texts.practice, { x: 1710, y: 100, width: 340, height: 140 }, now, { backgroundColor: '#FFF8C5' }),
    mkNote('node-onboard-practice-note', notes.practice, notePaths.practice, { x: 1710, y: 300, width: 400, height: 380 }, now),
    {
      id: 'node-onboard-shape',
      type: 'shape',
      title: shape.title,
      x: 1710,
      y: 740,
      width: 400,
      height: 170,
      data: {
        kind: 'rounded-rect',
        fill: '#E8EEF7',
        stroke: '#5B7CBF',
        strokeWidth: 2,
        text: shape.text,
        textColor: '#1f2328',
        fontSize: 14,
      },
      updatedAt: now,
    },
    mkText('node-onboard-idea', texts.idea, { x: 2190, y: 100, width: 340, height: 150 }, now, { backgroundColor: '#FFE9E3' }),
    mkNote('node-onboard-solution', notes.solution, notePaths.solution, { x: 2690, y: 100, width: 460, height: 360 }, now),
    mkText('node-onboard-edge-teach', texts.edgeTeach, { x: 2190, y: 310, width: 400, height: 130 }, now, { fontSize: 15 }),
    mkHtmlIframe('node-onboard-basics-card', iframes.basicsCard.title, iframes.basicsCard.html, { x: 2190, y: 520, width: 960, height: 480 }, now),

    // ---- 03 · Organize information ----------------------------------------
    mkFrame('node-onboard-frame-03', frames.organize, { x: 3330, y: 0, width: 1500, height: 1080 }, FRAME_COLORS.organize, now),
    mkText('node-onboard-frame-intro', texts.frameIntro, { x: 3390, y: 100, width: 620, height: 190 }, now, { fontSize: 16 }),
    {
      id: 'node-onboard-mindmap',
      type: 'mindmap',
      title: mindmap.title,
      x: 3390,
      y: 350,
      width: 680,
      height: 480,
      data: { root: toMindmapTopic(mindmap.root, 'wm-0'), layout: 'right', rev: 0 },
      updatedAt: now,
    },
    mkNote('node-onboard-kanban', notes.kanban, notePaths.kanban, { x: 4090, y: 100, width: 680, height: 400 }, now),
    mkNote('node-onboard-reference', notes.reference, notePaths.reference, { x: 4090, y: 560, width: 680, height: 380 }, now),

    // ---- 04 · Work with AI -------------------------------------------------
    mkFrame('node-onboard-frame-04', frames.ai, { x: 4950, y: 0, width: 1620, height: 1160 }, FRAME_COLORS.ai, now),
    mkText('node-onboard-ai-open', texts.aiOpen, { x: 5010, y: 100, width: 640, height: 130 }, now, { fontSize: 17 }),
    mkNote('node-onboard-prompts', notes.prompts, notePaths.prompts, { x: 5010, y: 280, width: 640, height: 500 }, now),
    mkNote('node-onboard-context', notes.context, notePaths.context, { x: 5010, y: 830, width: 640, height: 280 }, now),
    mkNote('node-onboard-meeting', notes.meeting, notePaths.meeting, { x: 5730, y: 100, width: 780, height: 360 }, now),
    mkText('node-onboard-feedback', texts.feedback, { x: 5730, y: 520, width: 780, height: 150 }, now, { backgroundColor: '#FFF8C5', fontSize: 16 }),
    mkUrlIframe('node-onboard-refpage', iframes.referencePage.title, iframes.referencePage.url, { x: 5730, y: 720, width: 780, height: 400 }, now),

    // ---- 05 · Power workflow ----------------------------------------------
    mkFrame('node-onboard-frame-05', frames.advanced, { x: 6690, y: 0, width: 1500, height: 1080 }, FRAME_COLORS.advanced, now),
    mkNote('node-onboard-project', notes.project, notePaths.project, { x: 6750, y: 100, width: 640, height: 430 }, now),
    mkNote('node-onboard-loop', notes.loop, notePaths.loop, { x: 6750, y: 590, width: 640, height: 440 }, now),
    mkHtmlIframe('node-onboard-shortcuts', iframes.shortcuts.title, iframes.shortcuts.html, { x: 7450, y: 100, width: 680, height: 540 }, now),
    mkText('node-onboard-multiws', texts.multiWorkspace, { x: 7450, y: 700, width: 680, height: 190 }, now, { fontSize: 15 }),
  ];

  const edgeList: unknown[] = [
    {
      id: 'edge-onboard-idea-solution',
      source: { kind: 'node', nodeId: 'node-onboard-idea', anchor: 'right' },
      target: { kind: 'node', nodeId: 'node-onboard-solution', anchor: 'left' },
      arrowHead: 'triangle',
      label: edges.ideaToSolution,
      updatedAt: now,
    },
    {
      id: 'edge-onboard-context-meeting',
      source: { kind: 'node', nodeId: 'node-onboard-context', anchor: 'right' },
      target: { kind: 'node', nodeId: 'node-onboard-meeting', anchor: 'left' },
      arrowHead: 'arrow',
      stroke: { style: 'dashed' },
      label: edges.contextToMeeting,
      updatedAt: now,
    },
  ];

  return { nodes, edges: edgeList };
}
