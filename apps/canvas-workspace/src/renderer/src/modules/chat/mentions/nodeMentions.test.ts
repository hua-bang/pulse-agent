// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import type { CanvasNode } from '../../../types';
import { createMentionChipElement, renderMdWithMentions } from './mentions';
import { buildNodeMentionMarker, parseNodeMention } from './nodeMentions';
import { serializeEditable } from './serializeEditable';
import { sessionTitleText } from '../components/utils/sessionTitle';

const node = (id: string, title: string, type: CanvasNode['type'] = 'file'): CanvasNode => (
  { id, type, title, x: 0, y: 0, width: 100, height: 100, data: {} } as CanvasNode
);

const renderChip = (content: string, nodes: CanvasNode[]) => {
  const container = document.createElement('div');
  container.innerHTML = renderMdWithMentions(content, nodes, { rootFolder: '/project' });
  return container.querySelector<HTMLElement>('.chat-mention-chip');
};

describe('node mention markers', () => {
  it('serializes composer node chips with their id', () => {
    const editable = document.createElement('div');
    editable.appendChild(createMentionChipElement({ type: 'node', nodeId: 'n-1', label: 'Plan', nodeType: 'text' }));
    editable.appendChild(createMentionChipElement({
      type: 'node',
      nodeId: 'n-2',
      label: 'Spec',
      nodeType: 'file',
      workspaceId: 'ws-b',
    }));

    expect(serializeEditable(editable)).toBe('@[node:n-1|Plan]@[node:ws-b:n-2|Spec]');
  });

  it('round-trips labels that contain marker syntax and keeps other text readable', () => {
    const marker = buildNodeMentionMarker({ nodeId: 'n:1', workspaceId: 'ws', label: 'a|b] 100% 中文' });

    expect(marker).toBe('node:ws:n%3A1|a%7Cb%5D 100%25 中文');
    expect(parseNodeMention(marker)).toEqual({ nodeId: 'n:1', workspaceId: 'ws', label: 'a|b] 100% 中文' });

    const chip = renderChip(`@[${marker}] 看看`, [node('n:1', 'Renamed')]);
    expect(chip?.dataset.nodeId).toBe('n:1');
    expect(chip?.textContent).toBe('Renamed');
  });

  it('resolves by id after a rename and among duplicate titles, showing the current label', () => {
    const nodes = [node('a', 'Notes'), node('b', 'Notes')];
    const chip = renderChip('@[node:b|Old name]', nodes);

    expect(chip?.dataset.nodeId).toBe('b');
    expect(chip?.textContent).toBe('Notes');
  });

  it('renders a deleted node as an inert chip instead of a same-named node or a file path', () => {
    const chip = renderChip('@[node:gone|Notes]', [node('other', 'Notes')]);

    expect(chip?.dataset.nodeId).toBe('');
    expect(chip?.dataset.filePath).toBeUndefined();
    expect(chip?.classList.contains('chat-mention-chip--clickable')).toBe(false);
    expect(chip?.textContent).toBe('Notes');
  });

  it('keeps legacy label markers resolving, including titles that start with node:', () => {
    expect(renderChip('@[Notes]', [node('legacy', 'Notes')])?.dataset.nodeId).toBe('legacy');
    expect(renderChip('@[node: draft]', [node('odd', 'node: draft')])?.dataset.nodeId).toBe('odd');
  });

  it('shows only the label in session titles', () => {
    expect(sessionTitleText('@[node:ws:n-1|Spec%7Cv2] 总结一下')).toBe('Spec|v2 总结一下');
  });
});
