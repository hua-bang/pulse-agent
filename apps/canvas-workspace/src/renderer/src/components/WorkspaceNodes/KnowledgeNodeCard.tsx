import type { CanvasNode, WorkspaceNodeListItem } from '../../types';
import { CheckIcon, ListLinesIcon, NodeTypeIcon, SparklesIcon } from '../icons';
import { Button } from '../ui/Button';
import { CardShell, type KnowledgeCardKind } from './CardShell';
import { NodeCardPreview } from './NodeCardPreview';

type PreviewKind = Extract<CanvasNode['type'], 'file' | 'text' | 'iframe' | 'image' | 'mindmap'>;

interface Props {
  node: WorkspaceNodeListItem;
  title: string;
  typeLabel: string;
  updatedLabel: string;
  tagLabels: string[];
  contextLabel: string;
  emptyPreviewLabel: string;
  aiSummaryLabel: string;
  aiSummaryConfirmedLabel: string;
  aiSummarizeLabel: string;
  aiChatLabel: string;
  selectForAiLabel: string;
  deselectForAiLabel: string;
  openLabel: string;
  selected: boolean;
  contextSelected?: boolean;
  onOpen: (trigger: HTMLButtonElement) => void;
  onToggleContextSelection?: () => void;
  onAskAi?: () => void;
  onSummarize?: () => void;
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
  contextLabel,
  emptyPreviewLabel,
  aiSummaryLabel,
  aiSummaryConfirmedLabel,
  aiSummarizeLabel,
  aiChatLabel,
  selectForAiLabel,
  deselectForAiLabel,
  openLabel,
  selected,
  contextSelected = false,
  onOpen,
  onToggleContextSelection,
  onAskAi,
  onSummarize,
}: Props) => {
  const kind: KnowledgeCardKind = isPreviewKind(node.type) ? node.type : 'generic';
  const hasAiActions = Boolean(onToggleContextSelection || onAskAi || onSummarize);

  return (
    <CardShell
      kind={kind}
      selected={selected}
      contextSelected={contextSelected}
      openLabel={openLabel}
      onOpen={onOpen}
      actions={hasAiActions ? (
        <>
          {onToggleContextSelection && (
            <Button
              variant="icon"
              size="xs"
              className="knowledge-node-card__action knowledge-node-card__action--select"
              aria-label={contextSelected ? deselectForAiLabel : selectForAiLabel}
              title={contextSelected ? deselectForAiLabel : selectForAiLabel}
              aria-pressed={contextSelected}
              onClick={onToggleContextSelection}
            >
              <CheckIcon size={13} />
            </Button>
          )}
          {onSummarize && (
            <Button
              size="xs"
              className="knowledge-node-card__action knowledge-node-card__action--summarize"
              onClick={onSummarize}
            >
              <SparklesIcon size={12} />
              <span>{aiSummarizeLabel}</span>
            </Button>
          )}
          {onAskAi && (
            <Button
              size="xs"
              className="knowledge-node-card__action knowledge-node-card__action--chat"
              onClick={onAskAi}
            >
              <span>{aiChatLabel}</span>
            </Button>
          )}
        </>
      ) : undefined}
    >
      <span className="knowledge-node-card__identity">
        <span className="knowledge-node-card__type" aria-label={typeLabel} title={typeLabel}>
          {isPreviewKind(node.type)
            ? <NodeTypeIcon type={node.type} size={14} />
            : <ListLinesIcon size={14} />}
        </span>
        <span className="knowledge-node-card__title">{title}</span>
      </span>
      <NodeCardPreview
        node={node}
        title={title}
        emptyLabel={emptyPreviewLabel}
        aiSummaryLabel={aiSummaryLabel}
        confirmedLabel={aiSummaryConfirmedLabel}
      />
      <span className="knowledge-node-card__footer">
        {tagLabels.length > 0 ? (
          <span className="knowledge-node-card__tags">
            {tagLabels.slice(0, 2).map((tag) => <span key={tag}>{tag}</span>)}
            {tagLabels.length > 2 && <span>+{tagLabels.length - 2}</span>}
          </span>
        ) : <span />}
        <span>{[contextLabel, updatedLabel].filter(Boolean).join(' · ')}</span>
      </span>
    </CardShell>
  );
};
