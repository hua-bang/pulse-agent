import { useEffect, useState } from 'react';
import { useDragResize } from '../ui';

const DEFAULT_SPLIT_WIDTH = 720;
const MIN_SPLIT_PANE_WIDTH = 280;
const SPLIT_DIVIDER_WIDTH = 6;
const RESIZING_CLASS = 'right-dock-resizing';

interface Options {
  active: boolean;
  dockWidth: number;
  setDockWidth: (update: (current: number) => number) => void;
  clampDockWidth: (value: number) => number;
}

export const useDockSplitView = ({ active, dockWidth, setDockWidth, clampDockWidth }: Options) => {
  const [contentWidth, setContentWidth] = useState(
    Math.round((DEFAULT_SPLIT_WIDTH - SPLIT_DIVIDER_WIDTH) / 2),
  );

  useEffect(() => {
    if (active) setDockWidth((current) => clampDockWidth(Math.max(current, DEFAULT_SPLIT_WIDTH)));
  }, [active, clampDockWidth, setDockWidth]);

  const maxContentWidth = Math.max(
    MIN_SPLIT_PANE_WIDTH,
    dockWidth - MIN_SPLIT_PANE_WIDTH - SPLIT_DIVIDER_WIDTH,
  );
  useEffect(() => {
    setContentWidth((current) => Math.min(maxContentWidth, Math.max(MIN_SPLIT_PANE_WIDTH, current)));
  }, [maxContentWidth]);

  const resize = useDragResize({
    axis: 'x',
    value: contentWidth,
    min: MIN_SPLIT_PANE_WIDTH,
    max: maxContentWidth,
    onChange: setContentWidth,
    onDragStart: () => document.documentElement.classList.add(RESIZING_CLASS),
    onDragEnd: () => document.documentElement.classList.remove(RESIZING_CLASS),
  });

  return {
    contentWidth,
    dividerWidth: SPLIT_DIVIDER_WIDTH,
    onDividerMouseDown: resize.onMouseDown,
  };
};
