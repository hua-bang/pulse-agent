import './index.css';
import '../NodeContextMenu/index.css';
import { useRef, useState } from 'react';
import { useI18n } from '../../../../../i18n';
import { Button } from '../../../../../components/ui';
import { Popover } from '../../../../../components/ui/Popover';
import { PlusIcon } from '../../../../../components/icons';
import { ZOOM_BUTTON_STEP, ZOOM_PRESETS } from '../../../runtime/useCanvasZoomControls';

interface Props {
  scale: number;
  onReset: () => void;
  /** Reframe the viewport around every node on the canvas. */
  onFitAll?: () => void;
  /** Step zoom around the view centre; enables the −/+ buttons. */
  onZoomBy?: (factor: number) => void;
  /** Exact zoom; when set, the percentage opens the preset menu. */
  onZoomTo?: (scale: number) => void;
  /** Frame the selection; the menu omits the entry without one. */
  onFitSelection?: () => void;
  /** Show or hide the minimap; the toggle is omitted without it. */
  onToggleMinimap?: () => void;
  minimapOpen?: boolean;
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

const MinimapGlyph = () => (
  <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <rect x="2" y="3" width="12" height="10" rx="1.5" stroke="currentColor" strokeWidth="1.3" />
    <rect x="7.5" y="7" width="4.5" height="4" rx="0.5" fill="currentColor" />
  </svg>
);

/** The minus partner of `PlusIcon`, drawn with the same stroke. */
const MinusGlyph = () => (
  <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <path d="M3 8h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
  </svg>
);

interface MenuItem {
  key: string;
  label: string;
  run: () => void;
}

export const ZoomIndicator = ({
  scale,
  onReset,
  onFitAll,
  onZoomBy,
  onZoomTo,
  onFitSelection,
  onToggleMinimap,
  minimapOpen = false,
}: Props) => {
  const { t } = useI18n();
  const [menuOpen, setMenuOpen] = useState(false);
  const percentRef = useRef<HTMLButtonElement>(null);
  const pct = Math.round(scale * 100);

  const menuItems: MenuItem[] = [];
  if (onZoomTo) {
    for (const preset of ZOOM_PRESETS) {
      menuItems.push({ key: `preset-${preset}`, label: `${preset * 100}%`, run: () => onZoomTo(preset) });
    }
  }
  if (onFitAll) menuItems.push({ key: 'fit-all', label: t('canvas.zoom.toFit'), run: onFitAll });
  if (onFitSelection) {
    menuItems.push({ key: 'fit-selection', label: t('canvas.zoom.toSelection'), run: onFitSelection });
  }

  return (
    <div className="zoom-indicator-group">
      {onToggleMinimap && (
        <div className="zoom-indicator zoom-indicator--stepper">
          <Button
            variant="icon"
            size="xs"
            className={`zoom-indicator__step${minimapOpen ? ' zoom-indicator--active' : ''}`}
            onClick={onToggleMinimap}
            aria-pressed={minimapOpen}
            aria-label={t('canvas.minimap.toggle')}
            title={t('canvas.minimap.toggle')}
          >
            <MinimapGlyph />
          </Button>
        </div>
      )}
      {onFitAll && (
        <button className="zoom-indicator" onClick={onFitAll} title={t('canvas.zoom.fitAll')}>
          <FitGlyph />
          {t('canvas.zoom.fitAllLabel')}
        </button>
      )}
      <div className="zoom-indicator zoom-indicator--stepper">
        {onZoomBy && (
          <Button
            variant="icon"
            size="xs"
            className="zoom-indicator__step"
            aria-label={t('canvas.zoom.zoomOut')}
            title={t('canvas.zoom.zoomOut')}
            onClick={() => onZoomBy(1 / ZOOM_BUTTON_STEP)}
          >
            <MinusGlyph />
          </Button>
        )}
        <button
          ref={percentRef}
          className="zoom-indicator__percent"
          aria-haspopup={onZoomTo ? 'menu' : undefined}
          aria-expanded={onZoomTo ? menuOpen : undefined}
          title={onZoomTo ? t('canvas.zoom.menuTitle') : t('canvas.zoom.resetTitle')}
          onClick={() => {
            if (onZoomTo) setMenuOpen((open) => !open);
            else onReset();
          }}
        >
          {pct}%
        </button>
        {onZoomBy && (
          <Button
            variant="icon"
            size="xs"
            className="zoom-indicator__step"
            aria-label={t('canvas.zoom.zoomIn')}
            title={t('canvas.zoom.zoomIn')}
            onClick={() => onZoomBy(ZOOM_BUTTON_STEP)}
          >
            <PlusIcon size={12} />
          </Button>
        )}
      </div>
      {menuOpen && (
        <Popover
          anchorRef={percentRef}
          placement="top"
          align="end"
          ariaLabel={t('canvas.zoom.menuTitle')}
          className="context-menu zoom-indicator-menu"
          onClose={() => setMenuOpen(false)}
        >
          {menuItems.map((item) => (
            <Button
              key={item.key}
              size="sm"
              role="menuitem"
              className="context-menu-item"
              onClick={() => {
                setMenuOpen(false);
                item.run();
              }}
            >
              <span className="context-menu-label">
                <strong>{item.label}</strong>
              </span>
            </Button>
          ))}
        </Popover>
      )}
    </div>
  );
};
