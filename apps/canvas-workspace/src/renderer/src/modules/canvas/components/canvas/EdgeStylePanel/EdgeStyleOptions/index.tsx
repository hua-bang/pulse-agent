import type { EdgeArrowCap, EdgeStroke } from '../../../../../../types';
import './index.css';
import { SwatchRow } from '../../../../../../components/ui';
import { useI18n, type I18nKey } from '../../../../../../i18n';
import { DEFAULT_EDGE_STROKE } from '../../../../../../../../shared/canvas';
import { CapPreview, strokeDasharrayFor } from '../previews';

export type EdgeStyleSection = 'color' | 'width' | 'style' | 'head' | 'tail';

const COLORS = [
  DEFAULT_EDGE_STROKE.color,
  '#e5484d',
  '#f76808',
  '#ffba18',
  '#30a46c',
  '#0091ff',
  '#8e4ec6',
];
const WIDTHS = [
  { label: 'S', value: 1.6 },
  { label: 'M', value: 2.4 },
  { label: 'L', value: 4 },
];
const STYLES: Array<NonNullable<EdgeStroke['style']>> = ['solid', 'dashed', 'dotted'];
const CAPS: EdgeArrowCap[] = ['none', 'triangle', 'arrow', 'dot', 'bar'];
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

interface Props {
  section: EdgeStyleSection;
  stroke: Required<EdgeStroke>;
  head: EdgeArrowCap;
  tail: EdgeArrowCap;
  changeStroke: (patch: Partial<EdgeStroke>) => void;
  changeHead: (cap: EdgeArrowCap) => void;
  changeTail: (cap: EdgeArrowCap) => void;
}

export const EdgeStyleOptions = ({
  section,
  stroke,
  head,
  tail,
  changeStroke,
  changeHead,
  changeTail,
}: Props) => {
  const { t } = useI18n();
  const styleLabel = (value: NonNullable<EdgeStroke['style']>) => t(STYLE_LABEL_KEY[value]);
  const capLabel = (value: EdgeArrowCap) => t(CAP_LABEL_KEY[value]);
  if (section === 'color') {
    return (
      <SwatchRow
        ariaLabel={t('edgeStyle.color', { color: stroke.color })}
        options={COLORS.map((color) => ({
          value: color,
          label: t('edgeStyle.colorOption', { color }),
        }))}
        value={stroke.color}
        onChange={(color) => changeStroke({ color })}
      />
    );
  }
  if (section === 'width') {
    return (
      <div className="edge-style-row">
        {WIDTHS.map((item) => {
          const selected = Math.abs(stroke.width - item.value) < 0.05;
          return (
            <button
              type="button"
              key={item.label}
              role="menuitemradio"
              aria-checked={selected}
              data-menu-autofocus={selected ? 'true' : undefined}
              className={`edge-style-btn${selected ? ' edge-style-btn--active' : ''}`}
              onClick={() => changeStroke({ width: item.value })}
              title={t('edgeStyle.widthOption', { label: item.label })}
              aria-label={t('edgeStyle.widthOption', { label: item.label })}
            >
              <svg width="26" height="18" viewBox="0 0 26 18">
                <line x1={3} y1={9} x2={23} y2={9} stroke="currentColor" strokeWidth={item.value} strokeLinecap="round" />
              </svg>
            </button>
          );
        })}
      </div>
    );
  }
  if (section === 'style') {
    return (
      <div className="edge-style-row">
        {STYLES.map((style) => (
          <button
            type="button"
            key={style}
            role="menuitemradio"
            aria-checked={style === stroke.style}
            data-menu-autofocus={style === stroke.style ? 'true' : undefined}
            className={`edge-style-btn${style === stroke.style ? ' edge-style-btn--active' : ''}`}
            onClick={() => changeStroke({ style })}
            title={styleLabel(style)}
            aria-label={styleLabel(style)}
          >
            <svg width="30" height="18" viewBox="0 0 30 18">
              <line x1={3} y1={9} x2={27} y2={9} stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeDasharray={strokeDasharrayFor(style)} />
            </svg>
          </button>
        ))}
      </div>
    );
  }
  const side = section === 'head' ? 'head' : 'tail';
  const current = side === 'head' ? head : tail;
  const change = side === 'head' ? changeHead : changeTail;
  return (
    <div className="edge-style-row edge-style-row--caps">
      {CAPS.map((cap) => {
        const labelKey = side === 'head' ? 'edgeStyle.arrowEndOption' : 'edgeStyle.arrowStartOption';
        const label = t(labelKey, { cap: capLabel(cap) });
        return (
          <button
            type="button"
            key={`${side}-${cap}`}
            role="menuitemradio"
            aria-checked={cap === current}
            data-menu-autofocus={cap === current ? 'true' : undefined}
            className={`edge-style-btn edge-style-btn--cap${cap === current ? ' edge-style-btn--active' : ''}`}
            onClick={() => change(cap)}
            title={label}
            aria-label={label}
          >
            <CapPreview cap={cap} color="currentColor" side={side} />
          </button>
        );
      })}
    </div>
  );
};
