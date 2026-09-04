import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import './index.css';
import type {
  CanvasEdge,
  CanvasNode,
  CanvasTransform,
  EdgeArrowCap,
  EdgeStroke,
} from '../../../../../types';
import {
  resolveEdgePathGeometry,
} from '../../../../../utils/edgeFactory';
import { useMenuKeyboardNav } from '../../../../../hooks/useMenuKeyboardNav';
import { useI18n, type I18nKey } from '../../../../../i18n';
import { resolveEdgeStroke } from '../../../../../../../shared/canvas';
import { EdgeStyleOptions, type EdgeStyleSection as Section } from './EdgeStyleOptions';
import { CapPreview, StylePreview, WidthPreview } from './previews';

/**
 * A compact floating panel, shown when an edge is selected, that lets
 * the user tweak its stroke color, width, dash style, arrow head / tail,
 * and delete it. Positioned above the edge's midpoint in screen space so
 * it tracks the edge as nodes move / the canvas pans.
 *
 * Surface chrome is a single row of "chips" — one per property — each
 * showing the edge's *current* value. Clicking a chip expands a second
 * row inside the same popover with the full option list for that
 * property. Only one section can be open at a time; selecting a value
 * (or clicking outside the panel) collapses it back to the chip row.
 * This keeps the panel's default footprint small so it doesn't swallow
 * the edge it's attached to.
 *
 * Clicks inside the panel are stopped from bubbling up into the canvas
 * click handler so changing style doesn't accidentally deselect the
 * edge we're editing.
 */
interface Props {
  edge: CanvasEdge;
  nodes: CanvasNode[];
  transform: CanvasTransform;
  onUpdate: (id: string, patch: Partial<CanvasEdge>) => void;
  onRemove: (id: string) => void;
}

const STYLE_LABEL_KEY: Record<NonNullable<EdgeStroke['style']>, I18nKey> = {
  solid: 'edgeStyle.style.solid',
  dashed: 'edgeStyle.style.dashed',
  dotted: 'edgeStyle.style.dotted',
};

const CAP_LABEL_KEY: Record<EdgeArrowCap, I18nKey> = {
  none: 'edgeStyle.cap.none',
  triangle: 'edgeStyle.cap.triangle',
  arrow: 'edgeStyle.cap.arrow',
  dot: 'edgeStyle.cap.dot',
  bar: 'edgeStyle.cap.bar',
};

export const EdgeStylePanel = ({
  edge,
  nodes,
  transform,
  onUpdate,
  onRemove,
}: Props) => {
  const { t } = useI18n();
  const resolvedStroke = resolveEdgeStroke(edge.stroke);
  const color = resolvedStroke.color;
  const width = resolvedStroke.width;
  const style = resolvedStroke.style;
  const head: EdgeArrowCap = edge.arrowHead ?? 'triangle';
  const tail: EdgeArrowCap = edge.arrowTail ?? 'none';

  const [openSection, setOpenSection] = useState<Section | null>(null);
  const popoverId = useId();
  const popoverRef = useRef<HTMLDivElement>(null);
  const chipRefs = useRef<Record<Section, HTMLButtonElement | null>>({
    color: null,
    width: null,
    style: null,
    head: null,
    tail: null,
  });
  // Collapse the popover whenever the selection switches to a different
  // edge — otherwise the old section would stay open against the fresh
  // current values, which feels confusing.
  useEffect(() => {
    setOpenSection(null);
  }, [edge.id]);
  const closeSection = useCallback((restoreFocus = false) => {
    const section = openSection;
    setOpenSection(null);
    if (restoreFocus && section) {
      chipRefs.current[section]?.focus();
    }
  }, [openSection]);

  // First Escape collapses the open option list and returns focus to the
  // active chip; with nothing open the press falls through to the canvas
  // handler (deselects the edge).
  useMenuKeyboardNav(popoverRef, () => closeSection(true), openSection !== null);

  // Resolve the edge's midpoint in canvas coords (accounts for bend),
  // then convert to screen coords via the current transform. The panel
  // sits inside `.canvas-container`, so transform.x/y (pan offset) map
  // directly to container-relative coordinates.
  const screenPos = useMemo(() => {
    const nodesById = new Map(nodes.map((n) => [n.id, n]));
    const mid = resolveEdgePathGeometry(edge, nodesById).midpoint;
    return {
      x: mid.x * transform.scale + transform.x,
      y: mid.y * transform.scale + transform.y,
    };
  }, [edge, nodes, transform]);

  // Keep the panel inside the canvas container: the CSS default hangs it
  // centered above the anchor, which cuts it off when the edge sits near the
  // top or side edges of the viewport. Measure after layout, clamp
  // horizontally, and flip below the anchor when there's no room above.
  const panelRef = useRef<HTMLDivElement>(null);
  const [placement, setPlacement] = useState<{ left: number; top: number; flipped: boolean } | null>(null);
  useLayoutEffect(() => {
    const el = panelRef.current;
    if (!el) return;
    const host = el.offsetParent as HTMLElement | null;
    const hostW = host?.clientWidth ?? window.innerWidth;
    const margin = 8;
    const gap = 12;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    const halfW = w / 2;
    const left = Math.max(margin + halfW, Math.min(screenPos.x, hostW - margin - halfW));
    const flipped = screenPos.y - h - gap < margin;
    setPlacement({ left, top: screenPos.y, flipped });
  }, [screenPos.x, screenPos.y, openSection]);

  const setStroke = (patch: Partial<EdgeStroke>) => {
    onUpdate(edge.id, { stroke: { ...resolvedStroke, ...patch } });
  };

  const toggleSection = (section: Section) =>
    setOpenSection((current) => (current === section ? null : section));

  // Wrapper that picks a value AND collapses the popover. Selecting is
  // always a terminal action — the user rarely wants to pick twice in
  // a row from the same property, and auto-collapsing keeps the panel
  // footprint minimal.
  const choose = (fn: () => void) => {
    fn();
    closeSection(true);
  };

  const renderChip = (
    section: Section,
    title: string,
    children: React.ReactNode,
  ) => (
    <button
      ref={(node) => { chipRefs.current[section] = node; }}
      type="button"
      className={`edge-chip${openSection === section ? ' edge-chip--active' : ''}`}
      onClick={() => toggleSection(section)}
      title={title}
      aria-label={title}
      aria-expanded={openSection === section}
      aria-haspopup="menu"
      aria-controls={openSection === section ? popoverId : undefined}
    >
      {children}
    </button>
  );

  const styleLabel = (value: NonNullable<EdgeStroke['style']>) => t(STYLE_LABEL_KEY[value]);
  const capLabel = (value: EdgeArrowCap) => t(CAP_LABEL_KEY[value]);

  return (
    <div
      ref={panelRef}
      className="edge-style-panel"
      style={{
        left: placement?.left ?? screenPos.x,
        top: placement?.top ?? screenPos.y,
        // Above the anchor by default; below it when clamped at the top.
        transform: placement?.flipped
          ? 'translate(-50%, 12px)'
          : 'translate(-50%, calc(-100% - 12px))',
      }}
      // Stop propagation so our own clicks don't hit the canvas-level
      // blank-click handler (which would deselect the edge we're styling).
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.stopPropagation()}
    >
      <div className="edge-style-chip-row">
        {renderChip(
          'color',
          t('edgeStyle.color', { color }),
          <span className="edge-chip-swatch" style={{ background: color }} />,
        )}
        {renderChip('width', t('edgeStyle.width'), <WidthPreview width={width} />)}
        {renderChip('style', t('edgeStyle.style', { style: styleLabel(style) }), <StylePreview style={style} />)}

        <div className="edge-style-divider" />

        {renderChip(
          'head',
          t('edgeStyle.arrowEnd'),
          <CapPreview cap={head} color="currentColor" side="head" />,
        )}
        {renderChip(
          'tail',
          t('edgeStyle.arrowStart'),
          <CapPreview cap={tail} color="currentColor" side="tail" />,
        )}

        <div className="edge-style-divider" />

        <button
          type="button"
          className="edge-chip edge-chip--danger"
          onClick={() => onRemove(edge.id)}
          title={t('edgeStyle.delete')}
          aria-label={t('edgeStyle.delete')}
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path
              d="M4 4l8 8M12 4L4 12"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
            />
          </svg>
        </button>
      </div>

      {openSection && (
        <div
          ref={popoverRef}
          id={popoverId}
          className="edge-style-popover"
          role="menu"
          aria-label={t('edgeStyle.options')}
        >
          <EdgeStyleOptions
            section={openSection}
            stroke={resolvedStroke}
            head={head}
            tail={tail}
            changeStroke={(patch) => choose(() => setStroke(patch))}
            changeHead={(cap) => choose(() => onUpdate(edge.id, { arrowHead: cap }))}
            changeTail={(cap) => choose(() => onUpdate(edge.id, { arrowTail: cap }))}
          />
        </div>
      )}
    </div>
  );
};
