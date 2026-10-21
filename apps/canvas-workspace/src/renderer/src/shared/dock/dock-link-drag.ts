/**
 * Drag payload for a dock web tab dropped onto the canvas. The dock writes it
 * next to its own reorder drag; the canvas reads it and adds a web node.
 */
export const DOCK_LINK_DRAG_TYPE = 'application/x-pulse-dock-link';

export interface DockLinkDrag {
  url: string;
  title: string;
}

export const writeDockLinkDrag = (dataTransfer: DataTransfer, drag: DockLinkDrag): void => {
  dataTransfer.setData(DOCK_LINK_DRAG_TYPE, JSON.stringify(drag));
  // Reorder inside the strip is a move; a canvas drop is a copy.
  dataTransfer.effectAllowed = 'copyMove';
};

export const readDockLinkDrag = (value: string): DockLinkDrag | null => {
  try {
    const drag = JSON.parse(value);
    if (typeof drag?.url !== 'string' || !drag.url) return null;
    return { url: drag.url, title: typeof drag.title === 'string' ? drag.title : '' };
  } catch {
    return null;
  }
};
