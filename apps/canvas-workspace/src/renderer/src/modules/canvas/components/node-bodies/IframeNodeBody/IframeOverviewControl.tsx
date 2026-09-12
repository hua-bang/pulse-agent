import { Eye, SquaresFour } from '@phosphor-icons/react';
import { Button } from '../../../../../components/ui';
import { useI18n } from '../../../../../i18n';
import type { CanvasNode, IframeNodeData } from '../../../../../types';

/** CSS owns low-zoom visibility, including when the node opts out of the badge. */
export const IframeOverviewControl = ({ node, onUpdate }: {
  node: CanvasNode;
  onUpdate: (id: string, patch: Partial<CanvasNode>) => void;
}) => {
  const { t } = useI18n();
  const data = node.data as IframeNodeData;
  const showContent = data.showContentAtOverview === true;
  const label = t(showContent ? 'iframe.overview.showOverview' : 'iframe.overview.showContent');
  return (
    <Button
      className="iframe-overview-control"
      variant="icon"
      size="sm"
      aria-label={label}
      aria-pressed={showContent}
      title={label}
      onPointerDown={(event) => event.stopPropagation()}
      onMouseDown={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => event.stopPropagation()}
      onClick={(event) => {
        event.stopPropagation();
        onUpdate(node.id, { data: { ...data, showContentAtOverview: !showContent } });
      }}
    >
      {showContent ? <SquaresFour size={16} /> : <Eye size={16} />}
    </Button>
  );
};
