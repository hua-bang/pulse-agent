import { useCallback, useEffect, useRef, useState } from 'react';
import { SHAPE_KINDS, SHAPE_KIND_LABEL, ShapePrimitive, type ShapeKind } from '../../utils/shapeGeometry';

interface Props {
  activeTool: string;
  onToolChange: (tool: string) => void;
}

const SHAPE_TOOL_PREFIX = 'shape-';

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
  const [popoverOpen, setPopoverOpen] = useState(false);
  const [lastKind, setLastKind] = useState<ShapeKind>('rect');
  const rootRef = useRef<HTMLDivElement>(null);

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

  // Close popover on outside click.
  useEffect(() => {
    if (!popoverOpen) return;
    const handleClick = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setPopoverOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [popoverOpen]);

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
        title={`${SHAPE_KIND_LABEL[displayKind]} (drag to draw)`}
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
        title="More shapes"
      >
        <svg width="8" height="8" viewBox="0 0 8 8" fill="none">
          <path d="M1.5 3l2.5 2.5L6.5 3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {popoverOpen && (
        <div className="shape-tool-popover">
          {SHAPE_KINDS.map((kind) => {
            const selected = displayKind === kind;
            return (
              <button
                key={kind}
                className={`shape-tool-option${selected ? ' shape-tool-option--active' : ''}`}
                onClick={() => handlePick(kind)}
                title={SHAPE_KIND_LABEL[kind]}
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
