import { readFileSync } from 'fs';
import { describe, expect, it } from 'vitest';

const dockCss = readFileSync(new URL('../index.css', import.meta.url), 'utf8');
const appCss = readFileSync(new URL('../../../../App.css', import.meta.url), 'utf8');

describe('RightDock interaction styles', () => {
  it('gives the tab close control a 24px pointer target', () => {
    expect(dockCss).toMatch(
      /\.right-dock__tab-close\s*\{[^}]*width:\s*24px;[^}]*height:\s*24px;/s,
    );
  });

  it('turns off both dock-edge and page-edge reflow motion when requested', () => {
    const dockReducedMotion = dockCss.match(/@media \(prefers-reduced-motion: reduce\)\s*\{([\s\S]*?)\n\}/)?.[1] ?? '';
    const appReducedMotion = appCss.match(/@media \(prefers-reduced-motion: reduce\)\s*\{([\s\S]*?)\n\}/)?.[1] ?? '';

    expect(dockReducedMotion).toMatch(/\.right-dock,/);
    expect(dockReducedMotion).toMatch(/transition:\s*none/);
    expect(appReducedMotion).toMatch(/\.app-body/);
    expect(appReducedMotion).toMatch(/transition:\s*none/);
  });
});
