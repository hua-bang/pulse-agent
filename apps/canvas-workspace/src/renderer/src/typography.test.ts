import { readFileSync, readdirSync } from 'node:fs';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const rendererRoot = fileURLToPath(new URL('.', import.meta.url));
const globalCss = readFileSync(join(rendererRoot, 'styles.css'), 'utf8');
const graphPageSource = readFileSync(join(rendererRoot, 'views/WorkspaceNodes/GraphPage.tsx'), 'utf8');
const mindmapExportSource = readFileSync(join(rendererRoot, 'utils/mindmapExport.ts'), 'utf8');
const canvasPackage = JSON.parse(
  readFileSync(join(rendererRoot, '../../../package.json'), 'utf8'),
) as { devDependencies?: Record<string, string> };

const collectCssFiles = (directory: string): string[] => readdirSync(directory, { withFileTypes: true })
  .flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? collectCssFiles(path) : extname(entry.name) === '.css' ? [path] : [];
  });

describe('renderer typography system', () => {
  it('keeps the product, mono, size, and weight tokens explicit', () => {
    expect(globalCss).toContain('--font-sans: "Lexend Variable", "PingFang SC"');
    expect(globalCss).toContain('--font-mono: "SF Mono", SFMono-Regular');
    expect(globalCss).toContain('--font-size-ui: 13px');
    expect(globalCss).toContain('--font-size-title: 15px');
    expect(globalCss).toContain('--font-size-page-title: 24px');
    expect(globalCss).toContain('--font-weight-regular: 400');
    expect(globalCss).toContain('--font-weight-medium: 500');
    expect(globalCss).toContain('--font-weight-emphasis: 600');
  });

  it('bundles only the Latin Lexend variable font at build time', () => {
    expect(canvasPackage.devDependencies?.['@fontsource-variable/lexend']).toBeTruthy();
    expect(globalCss).toContain('@fontsource-variable/lexend/files/lexend-latin-wght-normal.woff2');
    expect(globalCss).not.toContain('lexend-latin-ext-wght-normal.woff2');
    expect(globalCss).not.toContain('lexend-vietnamese-wght-normal.woff2');
  });

  it('uses the product font for canvas labels and waits for it before image export', () => {
    expect(graphPageSource).toContain('"Lexend Variable", "PingFang SC"');
    expect(graphPageSource).not.toContain('"SF Mono", "Fira Code"');
    expect(mindmapExportSource).toContain('await Promise.all([');
    expect(mindmapExportSource).toContain('document.fonts.load(`400 14px');
    expect(mindmapExportSource).toContain('document.fonts.load(`500 20px');
  });

  it('does not reintroduce heavy literal weights into renderer styles', () => {
    for (const path of collectCssFiles(rendererRoot)) {
      const css = readFileSync(path, 'utf8');
      expect(css, path).not.toMatch(/^\s*font-weight:\s*(?:[6-9]\d{2}|bold);/m);
      expect(css, path).not.toMatch(/^\s*font:\s*[6-9]\d{2}\b/m);
    }
  });

  it.each([
    'views/SkillsLibrary/index.css',
    'views/Scheduled/index.css',
    'views/PluginMarket/index.css',
    'views/WorkspaceNodes/index.css',
  ])('uses the page-title scale in %s', (relativePath) => {
    const css = readFileSync(join(rendererRoot, relativePath), 'utf8');
    expect(css).toContain('font-size: var(--font-size-page-title)');
    expect(css).toContain('font-weight: var(--font-weight-emphasis)');
  });
});
