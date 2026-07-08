import type { CanvasNode } from './storage';
import type {
  WelcomeContent,
  WelcomeHtmlCard,
  WelcomeMindmapTopicContent,
  WelcomeNoteContent,
  WelcomeTextContent,
} from './welcome-content-types';

/**
 * Geometry + node assembly for the seeded onboarding canvas.
 *
 * Five frames laid out left to right as a progressive product course about
 * Pulse Canvas itself: 01 Meet → 02 Essentials → 03 Organize → 04 Work with
 * AI → 05 Go deeper. Visual weight comes from styled HTML iframe cards; copy
 * comes from the locale content modules; this file owns coordinates, node
 * ids, and node data shapes only. Frames contain nodes spatially (no parent
 * pointers), so every child rect must stay inside its frame rect.
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

const mkCard = (
  id: string,
  card: WelcomeHtmlCard,
  rect: Rect,
  now: number,
): CanvasNode => ({
  id,
  type: 'iframe',
  title: card.title,
  ...rect,
  data: { url: '', html: card.html, mode: 'html', prompt: '' },
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
  const { frames, notes, texts, shape, download, cards, mindmap, edges } = content;

  const nodes: CanvasNode[] = [
    // ---- 01 · Meet Pulse Canvas -------------------------------------------
    mkFrame('node-onboard-frame-01', frames.welcome, { x: 0, y: 0, width: 1560, height: 1120 }, FRAME_COLORS.welcome, now),
    mkCard('node-onboard-hero', cards.hero, { x: 60, y: 100, width: 720, height: 300 }, now),
    mkCard('node-onboard-features', cards.featureGrid, { x: 60, y: 460, width: 720, height: 520 }, now),
    mkNote('node-welcome-note', notes.welcome, notePaths.welcome, { x: 840, y: 100, width: 640, height: 420 }, now),
    {
      id: 'node-welcome-download',
      type: 'iframe',
      title: download.title,
      x: 840,
      y: 560,
      width: 640,
      height: 420,
      data: { url: download.url, html: '', mode: 'url', prompt: '' },
      updatedAt: now,
    },
    mkText('node-onboard-guide', texts.guide, { x: 840, y: 1000, width: 640, height: 90 }, now, { fontSize: 22 }),

    // ---- 02 · Canvas essentials -------------------------------------------
    mkFrame('node-onboard-frame-02', frames.basics, { x: 1680, y: 0, width: 1700, height: 1120 }, FRAME_COLORS.basics, now),
    mkCard('node-onboard-concept', cards.concept, { x: 1740, y: 100, width: 760, height: 420 }, now),
    mkText('node-onboard-practice-text', texts.practice, { x: 1740, y: 570, width: 340, height: 150 }, now, { backgroundColor: '#FFF8C5' }),
    {
      id: 'node-onboard-shape',
      type: 'shape',
      title: shape.title,
      x: 1740,
      y: 770,
      width: 340,
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
    mkNote('node-onboard-practice-note', notes.practice, notePaths.practice, { x: 2120, y: 570, width: 380, height: 370 }, now),
    mkText('node-onboard-problem', texts.problem, { x: 2560, y: 100, width: 300, height: 170 }, now, { backgroundColor: '#FFE9E3', fontSize: 16 }),
    mkNote('node-onboard-answer', notes.answer, notePaths.answer, { x: 2940, y: 100, width: 380, height: 330 }, now),
    mkText('node-onboard-edge-teach', texts.edgeTeach, { x: 2560, y: 310, width: 360, height: 120 }, now, { fontSize: 15 }),
    mkCard('node-onboard-basics-card', cards.basics, { x: 2560, y: 470, width: 760, height: 470 }, now),

    // ---- 03 · Organize information ----------------------------------------
    mkFrame('node-onboard-frame-03', frames.organize, { x: 3500, y: 0, width: 1560, height: 1120 }, FRAME_COLORS.organize, now),
    mkText('node-onboard-frame-intro', texts.frameIntro, { x: 3560, y: 100, width: 620, height: 170 }, now, { fontSize: 16 }),
    {
      id: 'node-onboard-mindmap',
      type: 'mindmap',
      title: mindmap.title,
      x: 3560,
      y: 320,
      width: 640,
      height: 520,
      data: { root: toMindmapTopic(mindmap.root, 'wm-0'), layout: 'right', rev: 0 },
      updatedAt: now,
    },
    mkCard('node-onboard-kanban', cards.kanban, { x: 4260, y: 100, width: 740, height: 430 }, now),
    mkNote('node-onboard-reference', notes.reference, notePaths.reference, { x: 4260, y: 570, width: 740, height: 380 }, now),

    // ---- 04 · Work with AI -------------------------------------------------
    mkFrame('node-onboard-frame-04', frames.ai, { x: 5180, y: 0, width: 1680, height: 1120 }, FRAME_COLORS.ai, now),
    mkText('node-onboard-ai-open', texts.aiOpen, { x: 5240, y: 100, width: 640, height: 120 }, now, { fontSize: 17 }),
    mkCard('node-onboard-chat-mock', cards.chatMock, { x: 5240, y: 260, width: 640, height: 520 }, now),
    mkNote('node-onboard-context', notes.context, notePaths.context, { x: 5240, y: 830, width: 640, height: 250 }, now),
    mkNote('node-onboard-prompts', notes.prompts, notePaths.prompts, { x: 5960, y: 100, width: 780, height: 400 }, now),
    mkNote('node-onboard-ideas', notes.ideas, notePaths.ideas, { x: 5960, y: 560, width: 780, height: 280 }, now),
    mkText('node-onboard-feedback', texts.feedback, { x: 5960, y: 880, width: 780, height: 150 }, now, { backgroundColor: '#FFF8C5', fontSize: 16 }),

    // ---- 05 · Go deeper -----------------------------------------------------
    mkFrame('node-onboard-frame-05', frames.advanced, { x: 6980, y: 0, width: 1560, height: 1120 }, FRAME_COLORS.advanced, now),
    mkCard('node-onboard-workflow', cards.workflow, { x: 7040, y: 100, width: 720, height: 440 }, now),
    mkNote('node-onboard-project', notes.project, notePaths.project, { x: 7040, y: 600, width: 720, height: 400 }, now),
    mkCard('node-onboard-shortcuts', cards.shortcuts, { x: 7820, y: 100, width: 660, height: 400 }, now),
    mkText('node-onboard-multiws', texts.multiWorkspace, { x: 7820, y: 560, width: 660, height: 220 }, now, { fontSize: 15 }),
  ];

  const edgeList: unknown[] = [
    {
      id: 'edge-onboard-problem-answer',
      source: { kind: 'node', nodeId: 'node-onboard-problem', anchor: 'right' },
      target: { kind: 'node', nodeId: 'node-onboard-answer', anchor: 'left' },
      arrowHead: 'triangle',
      label: edges.problemToAnswer,
      updatedAt: now,
    },
    {
      id: 'edge-onboard-context-ideas',
      source: { kind: 'node', nodeId: 'node-onboard-context', anchor: 'right' },
      target: { kind: 'node', nodeId: 'node-onboard-ideas', anchor: 'left' },
      arrowHead: 'arrow',
      stroke: { style: 'dashed' },
      label: edges.contextToIdeas,
      updatedAt: now,
    },
  ];

  return { nodes, edges: edgeList };
}
