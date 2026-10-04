import type { ReactNode } from 'react';
import { useI18n } from '../../../../i18n';
import { RefreshIcon, SpinnerIcon } from '../../../../components/icons';
import { ZoomIndicator } from '../../../canvas/surface';
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
  onResetZoom: () => void;
  onFit: () => void;
}

/**
 * Mode switch plus the read-only viewport controls. Read-only uses the main
 * Canvas `ZoomIndicator` in the same bottom chrome slot, so entering Edit
 * (where the canonical Canvas renders its own) never moves or restyles it.
 */
export const CanvasPreviewChrome = ({
  scale,
  canFit,
  editingAllowed = false,
  editing = false,
  onEditToggle,
  onResetZoom,
  onFit,
}: ControlsProps) => {
  const { t } = useI18n();
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
        <div className="canvas-bottom-chrome canvas-preview__chrome">
          <div className="canvas-bottom-chrome__left">
            <ZoomIndicator scale={scale} onReset={onResetZoom} onFitAll={canFit ? onFit : undefined} />
          </div>
        </div>
      )}
    </>
  );
};
