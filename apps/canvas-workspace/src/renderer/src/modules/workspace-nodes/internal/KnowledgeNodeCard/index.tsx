import './index.css';
import type { CanvasNode, WorkspaceNodeListItem } from '../../../../types';
import { CheckIcon, ListLinesIcon, NodeTypeIcon, SparklesIcon } from '../../../../components/icons';
import { Button } from '../../../../components/ui/Button';
import { CardShell, type KnowledgeCardKind } from '../CardShell';
import { NodeCardPreview } from '../NodeCardPreview';

type PreviewKind = Extract<CanvasNode['type'], 'file' | 'text' | 'iframe' | 'image' | 'mindmap'>;

interface Props {
  node: WorkspaceNodeListItem;
  title: string;
  typeLabel: string;
  updatedLabel: string;
  tagLabels: string[];
  contextLabel: string;
  aiSummaryLabel: string;
  aiSummaryConfirmedLabel: string;
  aiSummarizeLabel: string;
  aiChatLabel: string;
  selectForAiLabel: string;
  deselectForAiLabel: string;
  openOnCanvasLabel?: string;
  openLabel: string;
  selected: boolean;
  contextSelected?: boolean;
  onOpen: (trigger: HTMLButtonElement) => void;
  onOpenOnCanvas?: () => void;
  onToggleContextSelection?: () => void;
  onAskAi?: () => void;
  onSummarize?: () => void;
}

const TargetGlyph = () => (
  <svg width="12" height="12" viewBox="0 0 14 14" fill="none" aria-hidden="true">
    <circle cx="7" cy="7" r="2.1" stroke="currentColor" strokeWidth="1.3" />
    <path d="M7 1.6v2.1M7 10.3v2.1M1.6 7h2.1M10.3 7h2.1" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
  </svg>
);

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
  aiSummaryLabel,
  aiSummaryConfirmedLabel,
  aiSummarizeLabel,
  aiChatLabel,
  selectForAiLabel,
  deselectForAiLabel,
  openOnCanvasLabel,
  openLabel,
  selected,
  contextSelected = false,
  onOpen,
  onOpenOnCanvas,
  onToggleContextSelection,
  onAskAi,
  onSummarize,
}: Props) => {
  const kind: KnowledgeCardKind = isPreviewKind(node.type) ? node.type : 'generic';
  const hasActions = Boolean(onToggleContextSelection || onOpenOnCanvas || onAskAi || onSummarize);

  return (
    <CardShell
      kind={kind}
      selected={selected}
      contextSelected={contextSelected}
      openLabel={openLabel}
      onOpen={onOpen}
      actions={hasActions ? (
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
          {onOpenOnCanvas && openOnCanvasLabel && (
            <Button
              variant="icon"
              size="xs"
              className="knowledge-node-card__action knowledge-node-card__action--locate"
              aria-label={openOnCanvasLabel}
              title={openOnCanvasLabel}
              onClick={onOpenOnCanvas}
            >
              <TargetGlyph />
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
          {onAskAi && !contextSelected && (
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
            ? <NodeTypeIcon type={node.type} size={14} colorize />
            : <ListLinesIcon size={14} />}
        </span>
        <span className="knowledge-node-card__title">{title}</span>
      </span>
      <NodeCardPreview
        node={node}
        title={title}
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

