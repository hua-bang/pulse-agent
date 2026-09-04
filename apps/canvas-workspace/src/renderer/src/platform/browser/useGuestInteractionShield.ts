import { useEffect } from 'react';
import { acquireInteractionShield } from '../../utils/interactionShield';

/** Keep guest webviews from swallowing outside presses while an overlay is open. */
export const useGuestInteractionShield = (active: boolean): void => {
  useEffect(() => {
    if (!active) return;
    return acquireInteractionShield();
  }, [active]);
};
