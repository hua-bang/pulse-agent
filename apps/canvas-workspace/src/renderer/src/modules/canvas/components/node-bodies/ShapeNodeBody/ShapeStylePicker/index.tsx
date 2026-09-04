import { useCallback } from 'react';
import { DropdownShell, SwatchRow } from '../../../../../../components/ui';
import { useI18n } from '../../../../../../i18n';
import type { CanvasNode, ShapeNodeData } from '../../../../../../types';
import { ShapePrimitive } from '../../../../../../utils/shapeGeometry';
import './index.css';

interface Props {
  node: CanvasNode;
  onUpdate: (id: string, patch: Partial<CanvasNode>) => void;
}

const FILL_PRESETS = [
  { name: 'Transparent', value: 'transparent' },
  { name: 'White', value: '#FFFFFF' },
  { name: 'Slate', value: '#E8EEF7' },
  { name: 'Red', value: '#FAD4CF' },
  { name: 'Orange', value: '#FADFC1' },
  { name: 'Yellow', value: '#F7EBC0' },
  { name: 'Green', value: '#CFE7D9' },
  { name: 'Teal', value: '#C9E5E8' },
  { name: 'Blue', value: '#CFDDF3' },
  { name: 'Purple', value: '#D9D0EE' },
  { name: 'Pink', value: '#F2D0E0' },
  { name: 'Gray', value: '#D9DCE2' },
] as const;

const STROKE_PRESETS = [
  { name: 'None', value: 'transparent' },
  { name: 'Black', value: '#1F2328' },
  { name: 'Gray', value: '#6E7681' },
  { name: 'Red', value: '#D7402B' },
  { name: 'Orange', value: '#D97A1F' },
  { name: 'Yellow', value: '#C9A31A' },
  { name: 'Green', value: '#2F8F5A' },
  { name: 'Teal', value: '#2E8A94' },
  { name: 'Blue', value: '#5B7CBF' },
  { name: 'Purple', value: '#7957C4' },
  { name: 'Pink', value: '#C94F8C' },
] as const;

const STROKE_WIDTHS = [0, 1, 2, 4, 6] as const;

export const ShapeStylePicker = ({ node, onUpdate }: Props) => {
  const { t } = useI18n();
  const data = node.data as ShapeNodeData;
  const patch = useCallback((next: Partial<ShapeNodeData>) => {
    onUpdate(node.id, { data: { ...data, ...next } });
  }, [data, node.id, onUpdate]);

  return (
    <div
      className="shape-style-trigger"
      onMouseDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
    >
      <DropdownShell
        panelClassName="shape-style-popover"
        placement="bottom"
        align="start"
        role="menu"
        ariaLabel={t('canvas.shapeStyle.title')}
        trigger={({ open, toggle }) => (
          <button
            type="button"
            className="shape-style-preview"
            title={t('canvas.shapeStyle.title')}
            aria-label={t('canvas.shapeStyle.title')}
            aria-haspopup="menu"
            aria-expanded={open}
            onClick={toggle}
          >
            <svg className="shape-style-preview-svg" viewBox="0 0 18 18" width="14" height="14">
              <ShapePrimitive
                kind={data.kind}
                width={18}
                height={18}
                fill={data.fill === 'transparent' ? 'none' : data.fill}
                stroke={data.stroke === 'transparent' ? 'rgba(0,0,0,0.25)' : data.stroke}
                strokeWidth={1.8}
              />
            </svg>
          </button>
        )}
      >
        <div className="shape-style-row">
          <span className="shape-style-label">{t('canvas.shapeStyle.fill')}</span>
          <SwatchRow
            ariaLabel={t('canvas.shapeStyle.fill')}
            options={FILL_PRESETS.map((preset) => ({
              value: preset.value,
              label: t('canvas.shapeStyle.fillOption', { name: preset.name }),
              isNone: preset.value === 'transparent',
            }))}
            value={data.fill}
            onChange={(next) => patch({ fill: next })}
          />
        </div>
        <div className="shape-style-row">
          <span className="shape-style-label">{t('canvas.shapeStyle.stroke')}</span>
          <SwatchRow
            ariaLabel={t('canvas.shapeStyle.stroke')}
            options={STROKE_PRESETS.map((preset) => ({
              value: preset.value,
              label: t('canvas.shapeStyle.strokeOption', { name: preset.name }),
              isNone: preset.value === 'transparent',
            }))}
            value={data.stroke}
            onChange={(next) => patch({ stroke: next })}
          />
        </div>
        <div className="shape-style-row" role="group" aria-label={t('canvas.shapeStyle.width')}>
          <span className="shape-style-label">{t('canvas.shapeStyle.width')}</span>
          <div className="shape-style-widths">
            {STROKE_WIDTHS.map((width) => (
              <button
                type="button"
                key={width}
                className={`shape-style-width-btn${data.strokeWidth === width ? ' shape-style-width-btn--active' : ''}`}
                role="menuitemradio"
                aria-checked={data.strokeWidth === width}
                title={t('canvas.shapeStyle.widthOption', { width })}
                aria-label={t('canvas.shapeStyle.widthOption', { width })}
                onClick={() => patch({ strokeWidth: width })}
              >
                {width === 0 ? (
                  <span className="shape-style-none-slash shape-style-none-slash--inline" />
                ) : (
                  <span
                    className="shape-style-width-bar"
                    style={{ height: Math.max(1, width) }}
                  />
                )}
              </button>
            ))}
          </div>
        </div>
      </DropdownShell>
    </div>
  );
};
