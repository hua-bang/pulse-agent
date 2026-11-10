interface WheelLike {
  ctrlKey: boolean;
  metaKey: boolean;
  deltaX: number;
  deltaY: number;
  target: EventTarget | null;
  currentTarget: EventTarget | null;
}

const SCROLLS = /auto|scroll/;

/**
 * True when the note should keep a wheel event for its own scrolling.
 *
 * The canvas pans and zooms with the wheel. A note that keeps every wheel
 * event makes the canvas feel stuck under the pointer, so the note keeps the
 * event only when some element under the pointer has content to scroll on
 * the wheel axis. Ctrl/Cmd + wheel is always canvas zoom.
 */
export const contentOwnsWheel = (event: WheelLike): boolean => {
  if (event.ctrlKey || event.metaKey) return false;
  const vertical = Math.abs(event.deltaY) >= Math.abs(event.deltaX);
  let element = event.target instanceof HTMLElement ? event.target : null;

  while (element) {
    const overflows = vertical
      ? element.scrollHeight > element.clientHeight
      : element.scrollWidth > element.clientWidth;
    if (overflows) {
      const style = window.getComputedStyle(element);
      if (SCROLLS.test(vertical ? style.overflowY : style.overflowX)) return true;
    }
    if (element === event.currentTarget) break;
    element = element.parentElement;
  }
  return false;
};
