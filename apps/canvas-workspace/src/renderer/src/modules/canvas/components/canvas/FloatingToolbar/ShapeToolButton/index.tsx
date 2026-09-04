import { useCallback, useEffect, useState } from 'react';
import { DropdownShell } from '../../../../../../components/ui';
import { useI18n, type I18nKey } from '../../../../../../i18n';
import {
  SHAPE_KINDS,
  ShapePrimitive,
  type ShapeKind,
} from '../../../../../../utils/shapeGeometry';
import './index.css';

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

export const ShapeToolButton = ({ activeTool, onToolChange }: Props) => {
  const { t } = useI18n();
  const [lastKind, setLastKind] = useState<ShapeKind>('rect');
  const activeKind: ShapeKind | null = activeTool.startsWith(SHAPE_TOOL_PREFIX)
    ? activeTool.slice(SHAPE_TOOL_PREFIX.length) as ShapeKind
    : null;
  const displayKind = activeKind ?? lastKind;

  useEffect(() => {
    if (activeKind) setLastKind(activeKind);
  }, [activeKind]);

  const handleMainClick = useCallback(() => {
    onToolChange(`${SHAPE_TOOL_PREFIX}${displayKind}`);
  }, [displayKind, onToolChange]);

  return (
    <DropdownShell
      className="shape-tool-split"
      panelClassName="shape-tool-popover"
      placement="top"
      align="start"
      role="menu"
      trigger={({ open, toggle }) => (
        <>
          <button
            className={`toolbar-btn shape-tool-main${activeKind ? ' toolbar-btn--active' : ''}`}
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
            className={`toolbar-btn shape-tool-caret${open ? ' toolbar-btn--active' : ''}`}
            onClick={(event) => {
              event.stopPropagation();
              toggle();
            }}
            title={t('canvas.toolbar.moreShapes')}
            aria-label={t('canvas.toolbar.moreShapes')}
            aria-haspopup="menu"
            aria-expanded={open}
          >
            <svg width="8" height="8" viewBox="0 0 8 8" fill="none">
              <path d="M1.5 3l2.5 2.5L6.5 3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        </>
      )}
    >
      {({ close }) => SHAPE_KINDS.map((kind) => (
        <button
          key={kind}
          type="button"
          className={`shape-tool-option${displayKind === kind ? ' shape-tool-option--active' : ''}`}
          onClick={() => {
            setLastKind(kind);
            onToolChange(`${SHAPE_TOOL_PREFIX}${kind}`);
            close();
          }}
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
      ))}
    </DropdownShell>
  );
};
