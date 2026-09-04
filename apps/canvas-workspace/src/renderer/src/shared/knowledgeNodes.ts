export type KnowledgeNodeType = 'text' | 'file' | 'iframe' | 'image' | 'mindmap';

export const isKnowledgeNodeType = (type: string | undefined): type is KnowledgeNodeType => (
  type === 'text'
  || type === 'file'
  || type === 'iframe'
  || type === 'image'
  || type === 'mindmap'
);
