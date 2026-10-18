import './WorkspaceReferencePreview.css';
import { useEffect, useState, type MouseEvent } from 'react';
import type { CanvasNode, CanvasSummaryBox } from '../../../../../../../../shared/canvas';
import { useI18n } from '../../../../../../i18n';

interface Props {
  workspaceId: string;
  /** Undefined when the workspace no longer exists. */
  workspaceName?: string;
  /** The live nodes, when this window already holds that canvas. */
  workspaceNodes?: CanvasNode[];
  nameSnapshot?: string;
  onOpen: (event: MouseEvent) => void;
}

/** Boxes shorter than this share of the drawn height cannot fit a title line. */
const MIN_TITLED_BOX_SHARE = 0.1;

interface Layout {
  nodeCount: number;
  boxes: CanvasSummaryBox[];
}

const toLayout = (nodes: CanvasNode[]): Layout => ({
  nodeCount: nodes.length,
  boxes: nodes
    .filter((node) => node.width > 0 && node.height > 0)
    .map(({ type, title, x, y, width, height }) => ({ type, title, x, y, width, height })),
});

/** Stored layout for a canvas this window has not loaded. `store.summaries`
 * reads only node boxes and starts no file watchers. */
const useStoredLayout = (workspaceId: string, skip: boolean) => {
  const [layout, setLayout] = useState<Layout | null>(null);
  useEffect(() => {
    const store = window.canvasWorkspace?.store;
    if (skip || !store?.summaries) return;
    let cancelled = false;
    void store.summaries([workspaceId]).then((result) => {
      const summary = result.ok ? result.summaries?.[workspaceId] : null;
      if (!cancelled && summary) setLayout(summary);
    });
    return () => {
      cancelled = true;
    };
  }, [skip, workspaceId]);
  return layout;
};

/**
 * Read-only card for a whole canvas: its card layout drawn to scale, its
 * name, and its card count. Double-click opens that canvas.
 */
export const WorkspaceReferencePreview = ({
  workspaceId,
  workspaceName,
  workspaceNodes,
  nameSnapshot,
  onOpen,
}: Props) => {
  const { t } = useI18n();
  const deleted = workspaceName === undefined;
  const stored = useStoredLayout(workspaceId, deleted || workspaceNodes !== undefined);
  const layout = workspaceNodes ? toLayout(workspaceNodes) : stored;

  if (deleted) {
    return (
      <div className="workspace-reference workspace-reference--deleted">
        <div className="workspace-reference__empty">{t('reference.canvas.deleted')}</div>
        <div className="workspace-reference__footer">
          <span className="workspace-reference__name">{nameSnapshot}</span>
        </div>
      </div>
    );
  }

  const boxes = layout?.boxes ?? [];
  const minX = Math.min(...boxes.map((box) => box.x));
  const minY = Math.min(...boxes.map((box) => box.y));
  const width = Math.max(1, Math.max(...boxes.map((box) => box.x + box.width)) - minX);
  const height = Math.max(1, Math.max(...boxes.map((box) => box.y + box.height)) - minY);
  const percent = (value: number, total: number) => `${(value / total) * 100}%`;
  let meta = '';
  if (layout) {
    meta = layout.nodeCount === 0
      ? t('launcher.workspaceEmpty')
      : t('launcher.workspaceMeta', { count: layout.nodeCount });
  }

  return (
    <div className="workspace-reference" onDoubleClick={onOpen} title={t('reference.canvas.openHint')}>
      <div className="workspace-reference__map" aria-hidden="true">
        {boxes.length > 0 && (
          <div className="workspace-reference__frame" style={{ aspectRatio: `${width} / ${height}` }}>
            {boxes.map((box, index) => (
              <div
                key={index}
                className="workspace-reference__box"
                data-type={box.type}
                style={{
                  left: percent(box.x - minX, width),
                  top: percent(box.y - minY, height),
                  width: percent(box.width, width),
                  height: percent(box.height, height),
                }}
              >
                {box.type === 'frame' || box.height / height < MIN_TITLED_BOX_SHARE ? null : box.title}
              </div>
            ))}
          </div>
        )}
      </div>
      <div className="workspace-reference__footer">
        <span className="workspace-reference__name">{workspaceName}</span>
        <span className="workspace-reference__meta">{meta}</span>
        <span className="workspace-reference__badge">{t('reference.canvas.readOnly')}</span>
      </div>
    </div>
  );
};
