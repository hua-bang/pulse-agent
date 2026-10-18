import { useId, useRef, useState, type ReactNode, type RefObject } from 'react';
import { DropdownShell } from '../../../../../components/ui';
import { useI18n } from '../../../../../i18n';
import type {
  ForceGraphCanvasHandle,
  GraphLayoutPreset,
} from '../../ForceGraphCanvas';
import './index.css';

interface Props {
  /** Rendered first, before the graph controls (the Knowledge view switch). */
  leading?: ReactNode;
  /** The graph search trigger, first inside the control group. */
  search?: ReactNode;
  graphRef: RefObject<ForceGraphCanvasHandle>;
  layoutPreset: GraphLayoutPreset;
  showLabels: boolean;
  showOffCanvas: boolean;
  showWorkspaceHubs: boolean;
  workspaceCount: number;
  onLayoutPresetChange: (preset: GraphLayoutPreset) => void;
  onReload: () => void;
  onShowLabelsChange: (value: boolean) => void;
  onShowOffCanvasChange: (value: boolean) => void;
  onShowWorkspaceHubsChange: (value: boolean) => void;
}

interface GraphToggleProps {
  label: string;
  pressed: boolean;
  onChange: (value: boolean) => void;
}

/** A view switch: the label names the setting and stays fixed; the check
 * mark and highlight show whether it is on. */
const GraphToggle = ({ label, pressed, onChange }: GraphToggleProps) => (
  <button
    type="button"
    className={`workspace-node-chip workspace-graph-toggle${pressed ? ' is-active' : ''}`}
    aria-pressed={pressed}
    onClick={() => onChange(!pressed)}
  >
    <span className="workspace-graph-toggle__check" aria-hidden="true" />
    {label}
  </button>
);

export const GraphToolbar = ({
  leading,
  search,
  graphRef,
  layoutPreset,
  showLabels,
  showOffCanvas,
  showWorkspaceHubs,
  workspaceCount,
  onLayoutPresetChange,
  onReload,
  onShowLabelsChange,
  onShowOffCanvasChange,
  onShowWorkspaceHubsChange,
}: Props) => {
  const { t } = useI18n();
  const [paused, setPaused] = useState(false);
  const menuId = useId();
  const buttonRef = useRef<HTMLButtonElement>(null);

  const togglePause = () => {
    graphRef.current?.setPaused(!paused);
    setPaused((value) => !value);
  };
  const cycleDensity = () => {
    onLayoutPresetChange(
      layoutPreset === 'compact'
        ? 'normal'
        : layoutPreset === 'normal'
          ? 'loose'
          : 'compact',
    );
  };

  return (
    <div className="workspace-graph-toolbar">
      {leading}
      <div className="workspace-graph-toolbar__group">
        {search}
        <GraphToggle
          label={t('workspaceGraph.showLabels')}
          pressed={showLabels}
          onChange={onShowLabelsChange}
        />
        {workspaceCount > 1 && (
          <GraphToggle
            label={t('workspaceGraph.groupByWorkspace')}
            pressed={showWorkspaceHubs}
            onChange={onShowWorkspaceHubsChange}
          />
        )}
        <GraphToggle
          label={t('workspaceGraph.showOffCanvas')}
          pressed={showOffCanvas}
          onChange={onShowOffCanvasChange}
        />
        <button
          className="workspace-node-chip workspace-node-chip--toolbar-action"
          onClick={() => graphRef.current?.zoomToFit()}
        >
          {t('workspaceGraph.fit')}
        </button>
        <DropdownShell
          className="workspace-graph-toolbar__more"
          panelClassName="workspace-graph-toolbar__menu"
          align="end"
          role="menu"
          ariaLabel={t('workspaceGraph.moreMenuLabel')}
          panelId={menuId}
          onOpenChange={(open, reason) => {
            if (!open && reason === 'escape') buttonRef.current?.focus();
          }}
          trigger={({ open, toggle }) => (
            <button
              ref={buttonRef}
              type="button"
              className="workspace-node-chip workspace-node-chip--toolbar-action"
              onClick={toggle}
              onKeyDown={(event) => {
                if (open || (event.key !== 'ArrowDown' && event.key !== 'ArrowUp')) return;
                event.preventDefault();
                event.stopPropagation();
                toggle();
              }}
              title={t('workspaceGraph.moreOptions')}
              aria-label={t('workspaceGraph.moreOptions')}
              aria-haspopup="menu"
              aria-expanded={open}
              aria-controls={open ? menuId : undefined}
            >
              {t('workspaceGraph.more')}
            </button>
          )}
        >
          {({ close }) => (
            <>
              <button
                type="button"
                className="workspace-graph-toolbar__menu-item"
                role="menuitem"
                onClick={togglePause}
              >
                {paused ? t('workspaceGraph.resumeLayout') : t('workspaceGraph.pauseLayout')}
              </button>
              <button
                type="button"
                className="workspace-graph-toolbar__menu-item"
                role="menuitem"
                onClick={cycleDensity}
              >
                {t('workspaceGraph.density', {
                  value: layoutPreset === 'compact'
                    ? t('workspaceGraph.density.compact')
                    : layoutPreset === 'loose'
                      ? t('workspaceGraph.density.loose')
                      : t('workspaceGraph.density.standard'),
                })}
              </button>
              <button
                type="button"
                className="workspace-graph-toolbar__menu-item"
                role="menuitem"
                onClick={() => {
                  close();
                  onReload();
                }}
              >
                {t('workspaceNodes.refresh')}
              </button>
            </>
          )}
        </DropdownShell>
      </div>
    </div>
  );
};
