import { readFileSync, readdirSync } from 'node:fs';
import { extname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const rendererRoot = fileURLToPath(new URL('.', import.meta.url));
const globalCss = readFileSync(join(rendererRoot, 'styles.css'), 'utf8');
const graphCanvasSource = readFileSync(join(rendererRoot, 'modules/workspace-nodes/internal/ForceGraphCanvas/index.tsx'), 'utf8');
const mindmapExportSource = readFileSync(join(rendererRoot, 'modules/canvas/mindmap/export.ts'), 'utf8');
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
    expect(globalCss).toMatch(/body\s*\{[^}]*font-size:\s*13px;[^}]*font-weight:\s*400;/s);
    expect(globalCss).toMatch(/h1,[\s\S]*?strong,[\s\S]*?b\s*\{[^}]*font-weight:\s*500;/s);
  });

  it('bundles only the Latin Lexend variable font at build time', () => {
    expect(canvasPackage.devDependencies?.['@fontsource-variable/lexend']).toBeTruthy();
    expect(globalCss).toContain('@fontsource-variable/lexend/files/lexend-latin-wght-normal.woff2');
    expect(globalCss).not.toContain('lexend-latin-ext-wght-normal.woff2');
    expect(globalCss).not.toContain('lexend-vietnamese-wght-normal.woff2');
  });

  it('uses the product font for canvas labels and waits for it before image export', () => {
    expect(graphCanvasSource).toContain('"Lexend Variable", "PingFang SC"');
    expect(graphCanvasSource).not.toContain('"SF Mono", "Fira Code"');
    expect(mindmapExportSource).toContain('await Promise.all([');
    expect(mindmapExportSource).toContain('document.fonts.load(`400 14px');
    expect(mindmapExportSource).toContain('document.fonts.load(`500 20px');
  });

  it('does not reintroduce heavy literal weights into renderer styles', () => {
    for (const path of collectCssFiles(rendererRoot)) {
      const css = readFileSync(path, 'utf8');
      expect(css, path).not.toMatch(/^\s*font-weight:\s*(?:[7-9]\d{2}|bold);/m);
      expect(css, path).not.toMatch(/^\s*font:\s*[6-9]\d{2}\b/m);
    }
  });

  it('reserves 600 weight for page titles and the product brand', () => {
    const allowed = new Set([
      'app/shell/Sidebar/index.css',
      'modules/plugin-market/internal/index.css',
      'modules/scheduled/internal/index.css',
      'modules/skills/internal/index.css',
      'modules/workspace-nodes/internal/index.css',
    ]);
    const declarations = collectCssFiles(rendererRoot).flatMap((path) => {
      const css = readFileSync(path, 'utf8');
      const count = css.match(/^\s*font-weight:\s*600;/gm)?.length ?? 0;
      return Array.from({ length: count }, () => relative(rendererRoot, path));
    });
    expect(new Set(declarations)).toEqual(allowed);
    expect(declarations).toHaveLength(allowed.size);
  });

  it.each([
    'modules/skills/internal/index.css',
    'modules/scheduled/internal/index.css',
    'modules/plugin-market/internal/index.css',
    'modules/workspace-nodes/internal/index.css',
  ])('uses the page-title scale in %s', (relativePath) => {
    const css = readFileSync(join(rendererRoot, relativePath), 'utf8');
    expect(css).toContain('font-size: 24px');
    expect(css).toContain('font-weight: 600');
  });
});
