import { useCallback, type Dispatch, type SetStateAction } from 'react';
import type {
  AgentNodeData,
  CanvasEdge,
  CanvasNode,
  FrameNodeData,
  IframeNodeData,
  MindmapNodeData,
  TextNodeData,
} from '../../../types';
import type { I18nKey } from '../../../i18n';
import { createDefaultEdge } from '../../../utils/edgeFactory';
import { genTopicId } from '../../../utils/nodeFactory';

type I18nParams = Record<string, string | number | boolean | null | undefined>;

interface NotifyArgs {
  tone: 'success';
  title: string;
  description?: string;
  autoCloseMs?: number;
}

interface UseCanvasDemoCanvasOptions {
  addEdge: (edge: CanvasEdge) => void;
  addNode: (type: CanvasNode['type'], x: number, y: number) => CanvasNode;
  getViewportCenter: () => { x: number; y: number } | null;
  notify: (args: NotifyArgs) => void;
  rootFolder?: string;
  setHighlightedId: (id: string) => void;
  setSelectedNodeIds: Dispatch<SetStateAction<string[]>>;
  t: (key: I18nKey, params?: I18nParams) => string;
  updateNode: (id: string, patch: Partial<CanvasNode>) => void;
}

export const useCanvasDemoCanvas = ({
  addEdge,
  addNode,
  getViewportCenter,
  notify,
  rootFolder,
  setHighlightedId,
  setSelectedNodeIds,
  t,
  updateNode,
}: UseCanvasDemoCanvasOptions) => useCallback(() => {
  const center = getViewportCenter();
  if (!center) return;

  const FRAME_W = 700;
  const FRAME_H = 540;
  const GAP = 80;
  const top = center.y - FRAME_H / 2;
  const leftA = center.x - (FRAME_W * 1.5 + GAP);
  const leftB = leftA + FRAME_W + GAP;
  const leftC = leftB + FRAME_W + GAP;

  const makeFrame = (x: number, title: string, color: string) => {
    const frame = addNode('frame', x, top);
    updateNode(frame.id, {
      title,
      width: FRAME_W,
      height: FRAME_H,
      data: { color } satisfies FrameNodeData,
    });
    return frame;
  };

  makeFrame(leftA, t('canvas.demo.frameCodeTitle'), '#2383e2');
  const goal = addNode('text', leftA + 34, top + 60);
  updateNode(goal.id, {
    title: t('canvas.demo.introTitle'),
    width: 300,
    height: 184,
    data: {
      content: t('canvas.demo.introContent'),
      textColor: '#1f2328',
      backgroundColor: '#ffffff',
      fontSize: 14,
      autoSize: false,
    } satisfies TextNodeData,
  });
  const repo = addNode('iframe', leftA + 366, top + 60);
  updateNode(repo.id, {
    title: t('canvas.demo.webTitle'),
    width: 300,
    height: 184,
    data: {
      url: 'https://github.com/hua-bang/pulse-agent',
      html: '',
      mode: 'url',
      prompt: '',
    } satisfies IframeNodeData,
  });
  const agent = addNode('agent', leftA + 34, top + 320);
  updateNode(agent.id, {
    title: t('canvas.demo.agentTitle'),
    width: 632,
    height: 196,
    data: {
      sessionId: '',
      ...(rootFolder ? { cwd: rootFolder } : {}),
      agentType: 'claude-code',
      status: 'idle',
      viewMode: 'setup',
      lastInitPrompt: t('canvas.demo.agentPrompt'),
    } satisfies AgentNodeData,
  });
  addEdge(createDefaultEdge(
    { kind: 'node', nodeId: goal.id, anchor: 'bottom' },
    { kind: 'node', nodeId: agent.id, anchor: 'auto' },
    { label: t('canvas.demo.edgeBrief'), stroke: { color: '#2383e2', width: 2.4, style: 'solid' } },
  ));
  addEdge(createDefaultEdge(
    { kind: 'node', nodeId: repo.id, anchor: 'bottom' },
    { kind: 'node', nodeId: agent.id, anchor: 'auto' },
    { label: t('canvas.demo.edgeContext'), stroke: { color: '#10b981', width: 2.4, style: 'solid' } },
  ));

  makeFrame(leftB, t('canvas.demo.frameResearchTitle'), '#f59e0b');
  const source = addNode('iframe', leftB + 34, top + 92);
  updateNode(source.id, {
    title: t('canvas.demo.researchWebTitle'),
    width: 300,
    height: 388,
    data: {
      url: 'https://github.com/hua-bang/pulse-agent/issues',
      html: '',
      mode: 'url',
      prompt: '',
    } satisfies IframeNodeData,
  });
  const takeaways = addNode('text', leftB + 366, top + 92);
  updateNode(takeaways.id, {
    title: t('canvas.demo.researchNoteTitle'),
    width: 300,
    height: 388,
    data: {
      content: t('canvas.demo.researchNoteContent'),
      textColor: '#1f2328',
      backgroundColor: '#ffffff',
      fontSize: 14,
      autoSize: false,
    } satisfies TextNodeData,
  });
  addEdge(createDefaultEdge(
    { kind: 'node', nodeId: source.id, anchor: 'right' },
    { kind: 'node', nodeId: takeaways.id, anchor: 'left' },
    { label: t('canvas.demo.edgeCapture'), stroke: { color: '#f59e0b', width: 2.4, style: 'solid' } },
  ));

  makeFrame(leftC, t('canvas.demo.frameBrainstormTitle'), '#9575d4');
  const ideas = addNode('mindmap', leftC + 150, top + 80);
  updateNode(ideas.id, {
    title: t('canvas.demo.brainstormMapTitle'),
    width: 400,
    height: 220,
    data: {
      root: {
        id: genTopicId(),
        text: t('canvas.demo.mapTopicRoot'),
        children: [
          { id: genTopicId(), text: t('canvas.demo.mapTopicA'), children: [] },
          { id: genTopicId(), text: t('canvas.demo.mapTopicB'), children: [] },
          { id: genTopicId(), text: t('canvas.demo.mapTopicC'), children: [] },
        ],
      },
      layout: 'right',
      rev: 0,
    } satisfies MindmapNodeData,
  });
  const plan = addNode('text', leftC + 170, top + 352);
  updateNode(plan.id, {
    title: t('canvas.demo.planNoteTitle'),
    width: 360,
    height: 162,
    data: {
      content: t('canvas.demo.planNoteContent'),
      textColor: '#1f2328',
      backgroundColor: '#ffffff',
      fontSize: 14,
      autoSize: false,
    } satisfies TextNodeData,
  });
  addEdge(createDefaultEdge(
    { kind: 'node', nodeId: ideas.id, anchor: 'bottom' },
    { kind: 'node', nodeId: plan.id, anchor: 'top' },
    { label: t('canvas.demo.edgePrioritize'), stroke: { color: '#9575d4', width: 2.4, style: 'solid' } },
  ));

  setSelectedNodeIds([goal.id]);
  setHighlightedId(goal.id);
  notify({
    tone: 'success',
    title: t('canvas.demo.createdTitle'),
    description: t('canvas.demo.createdDescription'),
    autoCloseMs: 2600,
  });
}, [
  addEdge,
  addNode,
  getViewportCenter,
  notify,
  rootFolder,
  setHighlightedId,
  setSelectedNodeIds,
  t,
  updateNode,
]);
