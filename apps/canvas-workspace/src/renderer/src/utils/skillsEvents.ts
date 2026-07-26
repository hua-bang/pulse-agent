const CANVAS_SKILLS_CHANGED_EVENT = 'pulse-canvas:skills-changed';

export const notifyCanvasSkillsChanged = (): void => {
  window.dispatchEvent(new Event(CANVAS_SKILLS_CHANGED_EVENT));
};

export const subscribeCanvasSkillsChanged = (listener: () => void): (() => void) => {
  window.addEventListener(CANVAS_SKILLS_CHANGED_EVENT, listener);
  return () => window.removeEventListener(CANVAS_SKILLS_CHANGED_EVENT, listener);
};
