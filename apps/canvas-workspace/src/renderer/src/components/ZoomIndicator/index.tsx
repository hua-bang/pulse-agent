import './index.css';
import { useI18n } from '../../i18n';

interface Props {
  scale: number;
  onReset: () => void;
  /** Reframe the viewport around every node on the canvas. */
  onFitAll?: () => void;
}

const FitGlyph = () => (
  <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <path
      d="M6 2.5H3.5A1 1 0 002.5 3.5V6M10 2.5h2.5a1 1 0 011 1V6M6 13.5H3.5a1 1 0 01-1-1V10M10 13.5h2.5a1 1 0 001-1V10"
      stroke="currentColor"
      strokeWidth="1.3"
      strokeLinecap="round"
    />
  </svg>
);

export const ZoomIndicator = ({ scale, onReset, onFitAll }: Props) => {
  const { t } = useI18n();
  const pct = Math.round(scale * 100);
  return (
    <div className="zoom-indicator-group">
      {onFitAll && (
        <button className="zoom-indicator" onClick={onFitAll} title={t('canvas.zoom.fitAll')}>
          <FitGlyph />
          {t('canvas.zoom.fitAllLabel')}
        </button>
      )}
      <button className="zoom-indicator" onClick={onReset} title={t('canvas.zoom.resetTitle')}>
        {pct}%
      </button>
    </div>
  );
};
