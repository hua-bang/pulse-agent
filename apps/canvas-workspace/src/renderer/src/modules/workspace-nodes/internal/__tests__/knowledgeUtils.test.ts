import { describe, expect, it } from 'vitest';
import type { WorkspaceNodeListItem, WorkspaceNodeRecord } from '../../../../types';
import { getNodeTitle, isBlankKnowledgeNode } from '../utils';
import { getNodeCardPreviewModel } from '../NodeCardPreview';

const item = (patch: Partial<WorkspaceNodeListItem>): WorkspaceNodeListItem => ({
  id: 'n1',
  type: 'text',
  title: 'Text',
  ...patch,
} as WorkspaceNodeListItem);

describe('knowledge node helpers', () => {
  it('titles a text record by its content, like the list card', () => {
    const record = {
      id: 'n1',
      type: 'text',
      title: 'Text',
      data: { content: '<p>Hello canvas text</p>' },
    } as unknown as WorkspaceNodeRecord;
    expect(getNodeTitle(record)).toBe('Hello canvas text');
  });

  it('treats placeholder-only text and notes as blank', () => {
    expect(isBlankKnowledgeNode(item({ summary: '' }))).toBe(true);
    expect(isBlankKnowledgeNode(item({ type: 'file', title: 'Untitled', summary: '' }))).toBe(true);
    expect(isBlankKnowledgeNode(item({ summary: 'Some prose' }))).toBe(false);
    expect(isBlankKnowledgeNode(item({ type: 'file', title: 'Plan', summary: '' }))).toBe(false);
    expect(isBlankKnowledgeNode(item({ summary: '', tags: ['idea'] }))).toBe(false);
  });

  it('drops markdown heading markers from card previews', () => {
    const model = getNodeCardPreviewModel(item({ summary: '## Goals\n- Ship it' }), 'Goals');
    expect(model).toEqual({ kind: 'text', excerpt: 'Goals Ship it' });
  });

  it('drops heading markers that a collapsed note summary has mid-line', () => {
    const model = getNodeCardPreviewModel(
      item({ type: 'file', title: 'note-1', summary: '# Brief ## Goals What to build' }),
      'note-1',
    );
    expect(model).toEqual({ kind: 'file', sections: ['Brief Goals What to build'] });
  });
});
