import { readFileSync } from 'fs';
import { describe, expect, it } from 'vitest';

const dockCss = readFileSync(new URL('../index.css', import.meta.url), 'utf8');
const appCss = readFileSync(new URL('../../../../App.css', import.meta.url), 'utf8');
const appSource = readFileSync(new URL('../../../../App.tsx', import.meta.url), 'utf8');
const pluginMarketListCss = readFileSync(
  new URL('../../../../views/PluginMarket/list.css', import.meta.url),
  'utf8',
);
const modalCss = readFileSync(
  new URL('../../../ui/Modal/index.css', import.meta.url),
  'utf8',
);

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

  it('reserves dock width on library routes and lets plugin rows respond to the remaining space', () => {
    expect(appSource).toMatch(/<RightDock[^>]*reserveSpace capWidth=/s);
    expect(appSource).not.toContain("reserveSpace={activeView !== 'skills' && activeView !== 'plugins'}");
    expect(pluginMarketListCss).toMatch(
      /\.plugin-market\s*\{[^}]*container-type:\s*inline-size;/s,
    );
    expect(pluginMarketListCss).toContain('@container (max-width: 760px)');
  });

  it('keeps plugin detail overlays inside the route and below the persistent dock', () => {
    expect(modalCss).toMatch(
      /\.ui-modal-backdrop--scoped\s*\{[^}]*position:\s*absolute;[^}]*z-index:\s*var\(--layer-canvas-chrome-raised\);/s,
    );
    expect(dockCss).toMatch(/\.right-dock\s*\{[^}]*z-index:\s*var\(--layer-dock\);/s);
  });
});
