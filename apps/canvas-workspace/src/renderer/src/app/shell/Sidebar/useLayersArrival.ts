import { useEffect, useState } from 'react';

/**
 * True while the side panel opens or closes because the canvas gained or lost
 * its layers, not because the user toggled it.
 *
 * The panel stays open while the canvas nodes load. If the canvas turns out
 * empty, the panel closes; a first node opens it again, and the last deleted
 * node closes it. A width slide would push the canvas sideways for 200 ms each
 * time. The sidebar sets `.sidebar--instant` while this is true, so the panel
 * lands at once. The value stays true for two frames, so the browser applies the new
 * width before the transition comes back. A user toggle does not change
 * `hasLayers`, so it still slides.
 */
export const useLayersArrival = (hasLayers: boolean): boolean => {
  const [settled, setSettled] = useState(hasLayers);

  useEffect(() => {
    if (settled === hasLayers) return undefined;
    let frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(() => setSettled(hasLayers));
    });
    return () => cancelAnimationFrame(frame);
  }, [hasLayers, settled]);

  return settled !== hasLayers;
};
