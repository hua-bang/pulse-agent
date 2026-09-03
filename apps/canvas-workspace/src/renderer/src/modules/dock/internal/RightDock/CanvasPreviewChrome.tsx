import type { ReactNode } from 'react';
import { useI18n } from '../../../../i18n';
import { PlusIcon, RefreshIcon, SpinnerIcon } from '../../../../components/icons';
import { Button } from '../../../../components/ui';

interface StateProps {
  label: string;
  kind: 'loading' | 'error';
  onRetry?: () => void;
  action?: ReactNode;
}

export const CanvasPreviewState = ({ label, kind, onRetry, action }: StateProps) => {
  const { t } = useI18n();
  const loading = kind === 'loading';
  return (
    <div
      className="canvas-preview canvas-preview--state"
      role="region"
      aria-label={label}
      aria-busy={loading}
    >
      <div
        className="canvas-preview__state"
        role={loading ? 'status' : 'alert'}
        aria-live={loading ? 'polite' : undefined}
      >
        {loading && (
          <span className="canvas-preview__spinner" aria-hidden="true">
            <SpinnerIcon size={15} />
          </span>
        )}
        <span>{t(loading ? 'rightDock.loadingCanvas' : 'rightDock.loadCanvasFailed')}</span>
        {!loading && onRetry && (
          <Button variant="secondary" size="xs" onClick={onRetry}>
            <RefreshIcon size={12} />
            {t('rightDock.retryCanvas')}
          </Button>
        )}
      </div>
      {action}
    </div>
  );
};

interface ControlsProps {
  scale: number;
  canFit: boolean;
  editingAllowed?: boolean;
  editing?: boolean;
  onEditToggle?: () => void;
  onZoomOut: () => void;
  onZoomIn: () => void;
  onFit: () => void;
}

export const CanvasPreviewChrome = ({
  scale,
  canFit,
  editingAllowed = false,
  editing = false,
  onEditToggle,
  onZoomOut,
  onZoomIn,
  onFit,
}: ControlsProps) => {
  const { t } = useI18n();
  const zoomPercent = Math.round(scale * 100);
  return (
    <>
      <div className="canvas-preview__mode-control canvas-preview__chrome">
        <span className={editing ? 'canvas-preview__editing' : 'canvas-preview__read-only'}>
          {t(editing ? 'rightDock.editingCanvas' : 'rightDock.readOnlyCanvasPreview')}
        </span>
        {editingAllowed && onEditToggle && (
          <Button
            variant="secondary"
            size="xs"
            className="canvas-preview__edit-toggle"
            aria-pressed={editing}
            onClick={onEditToggle}
          >
            {t(editing ? 'rightDock.finishEditingCanvas' : 'rightDock.editCanvas')}
          </Button>
        )}
      </div>
      {!editing && (
        <div
          className="canvas-preview__controls canvas-preview__chrome"
          role="toolbar"
          aria-label={t('rightDock.canvasPreviewZoom')}
        >
          <Button
            variant="icon"
            size="md"
            className="canvas-preview__zoom-button"
            aria-label={t('rightDock.zoomOut')}
            title={t('rightDock.zoomOut')}
            onClick={onZoomOut}
          >
            <span className="canvas-preview__minus" aria-hidden="true">−</span>
          </Button>
          <output
            className="canvas-preview__zoom-value"
            aria-live="polite"
            aria-label={t('rightDock.zoomLevel', { value: zoomPercent })}
          >
            {zoomPercent}%
          </output>
          <Button
            variant="icon"
            size="md"
            className="canvas-preview__zoom-button"
            aria-label={t('rightDock.zoomIn')}
            title={t('rightDock.zoomIn')}
            onClick={onZoomIn}
          >
            <PlusIcon size={14} />
          </Button>
          <Button
            variant="secondary"
            size="xs"
            className="canvas-preview__fit"
            disabled={!canFit}
            onClick={onFit}
            title={t('rightDock.fitCanvas')}
          >
            {t('rightDock.fitCanvas')}
          </Button>
        </div>
      )}
    </>
  );
};
