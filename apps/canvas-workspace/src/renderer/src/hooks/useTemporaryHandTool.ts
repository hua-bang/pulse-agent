import { useCallback, useEffect, useRef, useState } from 'react';
import { isImeComposing } from '../utils/ime';

const INTERACTIVE_SELECTOR = [
  'a[href]',
  'button',
  'input',
  'select',
  'textarea',
  '[contenteditable="true"]',
  '[role="button"]',
  '[role="menuitem"]',
  '[role="option"]',
  '[role="radio"]',
  '[role="textbox"]',
].join(',');

const isSpaceKey = (event: KeyboardEvent) =>
  event.key === ' ' || event.key === 'Spacebar' || event.code === 'Space';

const shouldIgnoreSpaceTarget = (target: EventTarget | null) => {
  if (!(target instanceof Element)) return false;
  if ((target as HTMLElement).isContentEditable) return true;
  return target.closest(INTERACTIVE_SELECTOR) !== null;
};

export const useTemporaryHandTool = (enabled: boolean) => {
  const [temporaryHandTool, setTemporaryHandTool] = useState(false);
  const temporaryHandToolRef = useRef(false);

  const stopTemporaryHandTool = useCallback(() => {
    if (!temporaryHandToolRef.current) return;
    temporaryHandToolRef.current = false;
    setTemporaryHandTool(false);
  }, []);

  useEffect(() => {
    if (!enabled) stopTemporaryHandTool();
  }, [enabled, stopTemporaryHandTool]);

  useEffect(() => {
    if (!enabled) return undefined;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        !isSpaceKey(event) ||
        isImeComposing(event) ||
        event.metaKey ||
        event.ctrlKey ||
        event.altKey ||
        shouldIgnoreSpaceTarget(event.target)
      ) {
        return;
      }

      event.preventDefault();
      if (event.repeat || temporaryHandToolRef.current) return;
      temporaryHandToolRef.current = true;
      setTemporaryHandTool(true);
    };

    const handleKeyUp = (event: KeyboardEvent) => {
      if (!isSpaceKey(event)) return;
      if (temporaryHandToolRef.current) event.preventDefault();
      stopTemporaryHandTool();
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    window.addEventListener('blur', stopTemporaryHandTool);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener('blur', stopTemporaryHandTool);
      temporaryHandToolRef.current = false;
    };
  }, [enabled, stopTemporaryHandTool]);

  return temporaryHandTool;
};
