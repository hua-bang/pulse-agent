import { describe, expect, it } from 'vitest';
import {
  applySceneInput,
  normalizeBoardPayload,
  sceneContent,
  skeletonToElements,
  summarizeScene,
} from '../scene';

describe('excalidraw scene helpers', () => {
  it('converts compact skeleton items into Excalidraw-like elements', () => {
    const elements = skeletonToElements([
      {
        type: 'rectangle',
        x: 10,
        y: 20,
        width: 120,
        height: 60,
        text: 'Agent',
      },
      {
        type: 'arrow',
        x: 140,
        y: 50,
        width: 80,
        height: 0,
        text: 'calls',
      },
    ]);

    expect(elements.map((element) => element.type)).toEqual([
      'rectangle',
      'text',
      'arrow',
      'text',
    ]);
    expect(elements[1].text).toBe('Agent');
    expect(elements[2].endArrowhead).toBe('arrow');
  });

  it('applies replace and append scene inputs', () => {
    const initial = normalizeBoardPayload({ title: 'Board' });
    const replaced = applySceneInput(initial, {
      title: 'Flow',
      skeleton: [{ type: 'text', text: 'Hello' }],
    }, 'replace');
    const appended = applySceneInput(replaced, {
      skeleton: [{ type: 'text', text: 'World' }],
    }, 'append');

    expect(replaced.title).toBe('Flow');
    expect(replaced.elements).toHaveLength(1);
    expect(appended.elements).toHaveLength(2);
    expect(summarizeScene(appended).texts).toEqual(['Hello', 'World']);
    expect(sceneContent(appended)).toContain('Excalidraw board: Flow');
  });
});
