import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { STRIPPED_PHOSPHOR_WEIGHTS, stripPhosphorWeights } from './phosphor-weights.mjs';

const appRoot = join(dirname(fileURLToPath(import.meta.url)), '../..');
const rendererRoot = join(appRoot, 'src/renderer');

const sourceFiles = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
  const path = join(dir, entry.name);
  if (entry.isDirectory()) return entry.name === 'node_modules' ? [] : sourceFiles(path);
  return /\.(tsx?|jsx?)$/.test(entry.name) && !/\.test\./.test(entry.name) ? [path] : [];
});

const phosphorDefs = () => {
  const require = createRequire(join(rendererRoot, 'index.html'));
  const pkgDir = dirname(require.resolve('@phosphor-icons/react/package.json'));
  return join(pkgDir, 'dist/defs');
};

describe('phosphor weight strip', () => {
  it('removes only the stripped weights from every def module', () => {
    const defsDir = phosphorDefs();
    const files = readdirSync(defsDir).filter((name) => name.endsWith('.es.js'));
    expect(files.length).toBeGreaterThan(1000);
    for (const name of files) {
      const stripped = stripPhosphorWeights(readFileSync(join(defsDir, name), 'utf8'));
      expect(stripped, name).not.toBeNull();
      for (const weight of STRIPPED_PHOSPHOR_WEIGHTS) {
        expect(stripped, name).not.toContain(`"${weight}",`);
      }
      for (const weight of ['regular', 'bold', 'fill', 'duotone']) {
        expect(stripped, name).toContain(`"${weight}",`);
      }
    }
  });

  it('leaves unexpected layouts unchanged', () => {
    expect(stripPhosphorWeights('export default new Map();')).toBeNull();
  });

  it('keeps renderer source off the stripped weights', () => {
    const offenders = sourceFiles(rendererRoot).filter((file) => {
      const source = readFileSync(file, 'utf8');
      if (!source.includes('@phosphor-icons/react') && !source.includes('weight')) return false;
      return STRIPPED_PHOSPHOR_WEIGHTS.some((weight) => (
        new RegExp(`weight\\s*[=:]\\s*\\{?\\s*['"\`]${weight}['"\`]`).test(source)
        || new RegExp(`['"\`]${weight}['"\`]\\s+as\\s+IconWeight`).test(source)
      ));
    });
    expect(offenders).toEqual([]);
  });
});
