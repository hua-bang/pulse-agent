import { useLayoutEffect, useState } from 'react';

export type DockReadingMode = 'side' | 'reading';

/** Layout-only promotion: guests, canvas transform and the original conversation
 * stay in their mounted owners. The sidebar width preference never changes. */
export const useDockReadingLayout = ({
  scope, visible, split, availableWidth, sideWidth, hasContent,
}: {
  scope: string; visible: boolean; split: boolean; availableWidth: number;
  sideWidth: number; hasContent: boolean;
}) => {
  const [selection, setSelection] = useState<{ scope: string; mode: DockReadingMode }>({ scope, mode: 'side' });
  const mode = selection.scope === scope ? selection.mode : 'side';
  const expanded = visible && hasContent && (mode !== 'side' || split);
  const width = expanded ? Math.max(0, availableWidth) : sideWidth;
  const setMode = (next: DockReadingMode) => setSelection({ scope, mode: next });
  useLayoutEffect(() => {
    if (!visible || !hasContent) setSelection({ scope, mode: 'side' });
  }, [visible, hasContent, scope]);
  useLayoutEffect(() => {
    const root = document.documentElement;
    root.dataset.dockReading = expanded ? 'reading' : 'side';
    // Covered content must not remain keyboard-focusable. Never unmount it:
    // the user's canvas viewport and conversation draft belong to that owner.
    const covered = expanded;
    const hosts = Array.from(document.querySelectorAll<HTMLElement>('.app-body > :not(.sidebar)'));
    const previous = hosts.map(element => element.inert);
    if (covered) hosts.forEach(element => { element.inert = true; });
    return () => {
      hosts.forEach((element, index) => { element.inert = previous[index]; });
      delete root.dataset.dockReading;
    };
  }, [expanded, scope]);
  return { expanded, width, mode, setMode };
};
