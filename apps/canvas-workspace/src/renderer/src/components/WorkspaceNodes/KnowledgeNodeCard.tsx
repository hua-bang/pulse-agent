import type { CanvasNode, WorkspaceNodeListItem } from '../../types';
import { ListLinesIcon, NodeTypeIcon } from '../icons';
import { CardShell, type KnowledgeCardKind } from './CardShell';
import { NodeCardPreview } from './NodeCardPreview';

type PreviewKind = Extract<CanvasNode['type'], 'file' | 'text' | 'iframe' | 'image' | 'mindmap'>;

interface Props {
  node: WorkspaceNodeListItem;
  title: string;
  typeLabel: string;
  updatedLabel: string;
  tagLabels: string[];
  noTagsLabel: string;
  contextLabel: string;
  emptyPreviewLabel: string;
  openLabel: string;
  selected: boolean;
  onOpen: (trigger: HTMLButtonElement) => void;
}

const isPreviewKind = (type: string): type is PreviewKind => (
  type === 'file'
  || type === 'text'
  || type === 'iframe'
  || type === 'image'
  || type === 'mindmap'
);

export const KnowledgeNodeCard = ({
  node,
  title,
  typeLabel,
  updatedLabel,
  tagLabels,
  noTagsLabel,
  contextLabel,
  emptyPreviewLabel,
  openLabel,
  selected,
  onOpen,
}: Props) => {
  const kind: KnowledgeCardKind = isPreviewKind(node.type) ? node.type : 'generic';

  return (
    <CardShell kind={kind} selected={selected} openLabel={openLabel} onOpen={onOpen}>
      <span className="knowledge-node-card__meta">
        <span className="knowledge-node-card__type">
          {isPreviewKind(node.type)
            ? <NodeTypeIcon type={node.type} size={14} />
            : <ListLinesIcon size={14} />}
          <span>{typeLabel}</span>
        </span>
        <time>{updatedLabel}</time>
      </span>
      <span className="knowledge-node-card__title">{title}</span>
      <NodeCardPreview node={node} title={title} emptyLabel={emptyPreviewLabel} />
      <span className="knowledge-node-card__footer">
        <span>{tagLabels.length > 0 ? tagLabels.slice(0, 3).join(' · ') : noTagsLabel}</span>
        <span>{contextLabel}</span>
      </span>
    </CardShell>
  );
};
