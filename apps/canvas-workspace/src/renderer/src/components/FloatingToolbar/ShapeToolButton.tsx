import { useCallback, useEffect, useRef, useState } from 'react';
import { SHAPE_KINDS, ShapePrimitive, type ShapeKind } from '../../utils/shapeGeometry';
import { useClickOutside } from '../../hooks/useClickOutside';
import { useMenuKeyboardNav } from '../../hooks/useMenuKeyboardNav';
import { useI18n, type I18nKey } from '../../i18n';

interface Props {
  activeTool: string;
  onToolChange: (tool: string) => void;
}

const SHAPE_TOOL_PREFIX = 'shape-';

const SHAPE_LABEL_KEYS: Record<ShapeKind, I18nKey> = {
  rect: 'canvas.shape.rect',
  'rounded-rect': 'canvas.shape.roundedRect',
  ellipse: 'canvas.shape.ellipse',
  triangle: 'canvas.shape.triangle',
  diamond: 'canvas.shape.diamond',
  hexagon: 'canvas.shape.hexagon',
  star: 'canvas.shape.star',
};

/**
 * Split-button toolbar entry for picking which shape to draw.
 *
 * Behavior:
 *   - Main button activates the last-used shape kind (defaults to rect).
 *     Clicking it toggles the draw tool on/off like any other tool.
 *   - The caret next to it opens a small popover listing every shape
 *     kind. Picking one both activates the tool and updates what the
 *     main button remembers, so repeated draws of the same shape stay
 *     one click away.
 */
export const ShapeToolButton = ({ activeTool, onToolChange }: Props) => {
  const { t } = useI18n();
  const [popoverOpen, setPopoverOpen] = useState(false);
  const [lastKind, setLastKind] = useState<ShapeKind>('rect');
  const rootRef = useRef<HTMLDivElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  // Derive the kind the main button should show: if a shape tool is
  // currently active, display it; otherwise fall back to the last one
  // the user picked. This keeps the icon truthful without storing the
  // kind twice.
  const activeKind: ShapeKind | null = activeTool.startsWith(SHAPE_TOOL_PREFIX)
    ? ((activeTool.slice(SHAPE_TOOL_PREFIX.length) as ShapeKind))
    : null;
  const displayKind: ShapeKind = activeKind ?? lastKind;
  const isActive = activeKind !== null;

  // Remember the active kind as the "last used" whenever it changes.
  // This way switching tools via another path (e.g. keyboard shortcut
  // down the road) still updates the main button.
  useEffect(() => {
    if (activeKind) setLastKind(activeKind);
  }, [activeKind]);

  const closePopover = useCallback(() => setPopoverOpen(false), []);

  // Close the popover on outside click or Escape, matching every other
  // canvas overlay. Arrow keys / Home / End cycle the shape options.
  useClickOutside(rootRef, closePopover, popoverOpen);
  useMenuKeyboardNav(popoverRef, closePopover, popoverOpen);

  const handleMainClick = useCallback(() => {
    onToolChange(`${SHAPE_TOOL_PREFIX}${displayKind}`);
  }, [displayKind, onToolChange]);

  const handleCaretClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setPopoverOpen((v) => !v);
  }, []);

  const handlePick = useCallback(
    (kind: ShapeKind) => {
      setLastKind(kind);
      onToolChange(`${SHAPE_TOOL_PREFIX}${kind}`);
      setPopoverOpen(false);
    },
    [onToolChange],
  );

  return (
    <div className="shape-tool-split" ref={rootRef}>
      <button
        className={`toolbar-btn shape-tool-main${isActive ? ' toolbar-btn--active' : ''}`}
        onClick={handleMainClick}
        title={t('canvas.shape.dragToDraw', { shape: t(SHAPE_LABEL_KEYS[displayKind]) })}
        aria-label={t('canvas.shape.dragToDraw', { shape: t(SHAPE_LABEL_KEYS[displayKind]) })}
      >
        <svg width="18" height="18" viewBox="0 0 18 18">
          <ShapePrimitive
            kind={displayKind}
            width={18}
            height={18}
            fill="none"
            stroke="currentColor"
            strokeWidth={1.4}
          />
        </svg>
      </button>
      <button
        className={`toolbar-btn shape-tool-caret${popoverOpen ? ' toolbar-btn--active' : ''}`}
        onClick={handleCaretClick}
        title={t('canvas.toolbar.moreShapes')}
        aria-label={t('canvas.toolbar.moreShapes')}
        aria-haspopup="menu"
        aria-expanded={popoverOpen}
      >
        <svg width="8" height="8" viewBox="0 0 8 8" fill="none">
          <path d="M1.5 3l2.5 2.5L6.5 3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {popoverOpen && (
        <div
          ref={popoverRef}
          className="shape-tool-popover"
          role="menu"
          aria-label={t('canvas.toolbar.moreShapes')}
        >
          {SHAPE_KINDS.map((kind) => {
            const selected = displayKind === kind;
            return (
              <button
                key={kind}
                type="button"
                className={`shape-tool-option${selected ? ' shape-tool-option--active' : ''}`}
                onClick={() => handlePick(kind)}
                title={t(SHAPE_LABEL_KEYS[kind])}
                role="menuitem"
                aria-label={t(SHAPE_LABEL_KEYS[kind])}
              >
                <svg width="20" height="20" viewBox="0 0 20 20">
                  <ShapePrimitive
                    kind={kind}
                    width={20}
                    height={20}
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={1.4}
                  />
                </svg>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
};
