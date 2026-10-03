import { describe, expect, it } from 'vitest';
import { requestAskModeApproval } from './tool-policy';
import { createApprovalNodePreview } from './approval-node-preview';
import type { AgentClarificationRequest } from '../../shared/agent-chat';

describe('approval node previews', () => {
  it('carries a complete normalized mindmap beyond the truncated parameter excerpt', async () => {
    let request: AgentClarificationRequest | undefined;
    const children = Array.from({ length: 40 }, (_, index) => ({ text: `Topic ${index}` }));
    const result = await requestAskModeApproval({
      name: 'canvas_create_node',
      input: { type: 'mindmap', title: 'Overview', data: { root: { text: 'Root', children } } },
      context: {
        toolCallId: 'preview-1',
        onClarificationRequest: async proposed => {
          request = JSON.parse(JSON.stringify(proposed));
          return 'No';
        },
      },
    });

    expect(result.approved).toBe(false);
    expect(request?.context).toHaveLength(1_216);
    expect(request?.nodePreview).toMatchObject({
      id: 'approval-preview:preview-1',
      type: 'mindmap',
      data: { root: { children: expect.arrayContaining([{ id: expect.any(String), text: 'Topic 39', children: [] }]) } },
    });
  });

  it.each([42, { path: '/tmp/image.png' }, ['/tmp/image.png'], true, null, undefined])(
    'normalizes invalid image paths (%j) before approval', (filePath) => {
      expect(createApprovalNodePreview('canvas_create_node', {
        type: 'image', data: { filePath },
      }, 'preview')?.data).toEqual({ filePath: '' });
    },
  );

  it.each(['/tmp/image with spaces.png', 'C:\\images\\photo.png', ''])('preserves image path %s', (filePath) => {
    expect(createApprovalNodePreview('canvas_create_node', {
      type: 'image', data: { filePath },
    }, 'preview')?.data).toEqual({ filePath });
  });

  it('does not mount active node types or unrelated tool inputs', () => {
    for (const type of ['terminal', 'agent', 'iframe', 'plugin', 'file']) {
      expect(createApprovalNodePreview('canvas_create_node', { type }, 'preview')).toBeUndefined();
    }
    expect(createApprovalNodePreview('canvas_update_node', { type: 'text' }, 'preview')).toBeUndefined();
  });

  it('uses the creation defaults for empty mindmaps and null shape styles', () => {
    expect(createApprovalNodePreview('canvas_create_node', { type: 'mindmap' }, 'preview')?.data).toMatchObject({
      root: { text: 'Central topic', children: [] },
    });
    expect(createApprovalNodePreview('canvas_create_node', {
      type: 'shape', data: { kind: 'invalid', fill: null, stroke: null, strokeWidth: null },
    }, 'preview')?.data).toMatchObject({
      kind: 'rect', fill: '#E8EEF7', stroke: '#5B7CBF', strokeWidth: 2,
    });
  });
});
