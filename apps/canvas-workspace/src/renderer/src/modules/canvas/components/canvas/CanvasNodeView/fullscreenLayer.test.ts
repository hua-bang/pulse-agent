import { readFileSync } from 'fs';
import { describe, expect, it } from 'vitest';

const nodeCss = readFileSync(new URL('./index.css', import.meta.url), 'utf8');

describe('fullscreen node layer', () => {
  it('keeps a selected fullscreen node above the backdrop', () => {
    // The fullscreen rule sets z-index 60 over the backdrop (50). A more
    // specific selected-node rule must not pull a fullscreen node back down,
    // or the node dims and a click on its content exits fullscreen.
    const selectedLayerRules = [...nodeCss.matchAll(/([^{}]*\.canvas-node--selected[^{}]*)\{([^}]*)\}/g)]
      .filter(([, , body]) => /z-index\s*:/.test(body))
      .map(([, selector]) => selector.trim());
    expect(selectedLayerRules.length).toBeGreaterThan(0);
    for (const selector of selectedLayerRules) {
      expect(selector).toContain(':not(.canvas-node--fullscreen)');
    }
    expect(nodeCss).toMatch(/\.canvas-node\.canvas-node--fullscreen,[^{]*\{[^}]*z-index:\s*60;/s);
  });
});
