/**
 * One content tab in the dock's tab strip (link / artifact / node detail /
 * canvas preview / skill), with its drag, close, and pointer affordances.
 *
 * Split out of `RightDock` so the strip's markup stays readable; the dock
 * still owns activation, drag state and the tab menu.
 */
import type { DragEvent, MouseEvent } from 'react';
import { useI18n } from '../../../i18n';
import { DockTabIcon } from './DockTabIcon';
import { dockPaneElementId, dockTabElementId } from './dock-tab-ids';
import type { DockPreviewTab } from './dock-types';
import type { DockTabVisualState } from './dock-tab-visual-state';

interface Props {
  tab: DockPreviewTab;
  visual: DockTabVisualState;
  tabIndex: number;
  registerTab: (id: string, element: HTMLButtonElement | null) => void;
  onActivate: (id: string) => void;
  /** Left-click on a web tab — hands keyboard focus to the page. */
  onFocusPage: (id: string) => void;
  onClose: (id: string) => void;
  onContextMenu: (id: string, x: number, y: number) => void;
  onDragStart: (event: DragEvent<HTMLElement>, id: string) => void;
  onDragOver: (event: DragEvent<HTMLElement>, id: string) => void;
  onDrop: (event: DragEvent<HTMLElement>, id: string) => void;
  onDragEnd: () => void;
}

export const DockContentTab = ({
  tab,
  visual,
  tabIndex,
  registerTab,
  onActivate,
  onFocusPage,
  onClose,
  onContextMenu,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
}: Props) => {
  const { t } = useI18n();

  const onMouseDown = (event: MouseEvent<HTMLButtonElement>) => {
    // Activate on mouse-down: once the gesture turns into a drag the browser
    // suppresses the click, so click-only activation reads as "tab didn't
    // respond" after a few px of pointer slip.
    if (event.button === 0) {
      onActivate(tab.id);
      // Clicking a web tab should leave the page ready to scroll and type,
      // instead of requiring a second click into it.
      if (tab.kind === 'link') onFocusPage(tab.id);
    }
    // Middle-click closes, as everywhere else tabs exist; preventDefault
    // stops the auto-scroll cursor.
    if (event.button === 1) event.preventDefault();
  };

  return (
    <span
      className="right-dock__tab-shell"
      data-split-visible={visual.splitVisible}
      data-split-part={visual.splitPart}
      onDragOver={(event) => onDragOver(event, tab.id)}
      onDrop={(event) => onDrop(event, tab.id)}
    >
      <button
        ref={(element) => registerTab(tab.id, element)}
        type="button"
        id={dockTabElementId(tab.id)}
        data-dock-tab-id={tab.id}
        role="tab"
        aria-controls={dockPaneElementId(tab.id)}
        aria-selected={visual.selected}
        aria-expanded={visual.splitActive ? visual.splitVisible : undefined}
        className={`right-dock__tab right-dock__tab--with-close${visual.focused ? ' right-dock__tab--active' : ''}`}
        data-focused={visual.focused}
        data-split-visible={visual.splitVisible}
        // A shrunken tab shows little of its title, so the tooltip carries the
        // address a web tab is actually pointing at.
        title={tab.kind === 'link' && tab.url ? `${tab.title}\n${tab.url}` : tab.title}
        draggable
        tabIndex={tabIndex}
        onDragStart={(event) => onDragStart(event, tab.id)}
        onDragEnd={onDragEnd}
        onMouseDown={onMouseDown}
        onAuxClick={(event) => {
          if (event.button !== 1) return;
          event.preventDefault();
          onClose(tab.id);
        }}
        onClick={() => onActivate(tab.id)}
        onContextMenu={(event) => {
          event.preventDefault();
          onContextMenu(tab.id, event.clientX, event.clientY);
        }}
      >
        <DockTabIcon
          kind={tab.kind}
          faviconUrl={tab.kind === 'link' ? tab.faviconUrl : undefined}
        />
        <span className="right-dock__tab-title">{tab.title}</span>
      </button>
      <button
        type="button"
        aria-label={t('rightDock.closeTab', { title: tab.title })}
        title={t('rightDock.closeTab', { title: tab.title })}
        className="right-dock__tab-close"
        onClick={(event) => {
          event.stopPropagation();
          onClose(tab.id);
        }}
      >
        ×
      </button>
    </span>
  );
};
