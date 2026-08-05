/** Restore composer focus after React has committed an async chat transition. */
export const restoreComposerFocusAfterRender = (
  focusInput: () => void,
  interactionOwner: Element | null,
) => {
  window.requestAnimationFrame(() => {
    const activeElement = document.activeElement;
    if (activeElement === interactionOwner || activeElement === document.body) {
      focusInput();
    }
  });
};
