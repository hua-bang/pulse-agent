import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  isBuildStale,
  missingSystemPackages,
  newestMtime,
  planBuilds,
  resolveQuickstartCa,
} from '../bootstrap.mjs';

const dirs = [];
const tempDir = () => {
  const dir = mkdtempSync(join(tmpdir(), 'harness-bootstrap-'));
  dirs.push(dir);
  return dir;
};
const touch = (file, seconds) => {
  mkdirSync(join(file, '..'), { recursive: true });
  writeFileSync(file, '');
  utimesSync(file, seconds, seconds);
};

afterEach(() => {
  while (dirs.length) rmSync(dirs.pop(), { recursive: true, force: true });
});

describe('build staleness', () => {
  it('ignores node_modules and dist when scanning inputs', () => {
    const dir = tempDir();
    touch(join(dir, 'src', 'a.ts'), 1_000);
    touch(join(dir, 'src', 'node_modules', 'x.js'), 9_000);
    touch(join(dir, 'src', 'dist', 'y.js'), 9_000);
    expect(newestMtime([join(dir, 'src')])).toBe(1_000_000);
  });

  it('is stale when the output is missing or older than an input', () => {
    const dir = tempDir();
    const output = join(dir, 'dist', 'index.js');
    touch(join(dir, 'src', 'a.ts'), 2_000);
    expect(isBuildStale({ output, inputs: [join(dir, 'src')] })).toBe(true);
    touch(output, 1_000);
    expect(isBuildStale({ output, inputs: [join(dir, 'src')] })).toBe(true);
    touch(output, 3_000);
    expect(isBuildStale({ output, inputs: [join(dir, 'src')] })).toBe(false);
  });

  it('rebuilds from the first stale target through the rest of the chain', () => {
    const targets = ['engine', 'teams', 'cli', 'app'];
    expect(planBuilds(targets, (t) => t === 'teams')).toEqual(['teams', 'cli', 'app']);
    expect(planBuilds(targets, () => false)).toEqual([]);
  });
});

describe('resolveQuickstartCa', () => {
  const exists = () => true;

  it('prefers an explicit CA over proxy detection', () => {
    expect(resolveQuickstartCa({ 'ca-cert': '/a.pem' }, { HTTPS_PROXY: 'x', NODE_EXTRA_CA_CERTS: '/b.pem' }, exists))
      .toBe('/a.pem');
    expect(resolveQuickstartCa({}, { PULSE_CANVAS_HARNESS_CA_CERT: '/c.pem' }, exists)).toBe('/c.pem');
  });

  it('reuses the Node CA bundle only behind an HTTPS proxy', () => {
    expect(resolveQuickstartCa({}, { NODE_EXTRA_CA_CERTS: '/b.pem' }, exists)).toBeUndefined();
    expect(resolveQuickstartCa({}, { https_proxy: 'x', SSL_CERT_FILE: '/s.pem' }, exists)).toBe('/s.pem');
    expect(resolveQuickstartCa({}, { HTTPS_PROXY: 'x', NODE_EXTRA_CA_CERTS: '/gone.pem' }, () => false))
      .toBeUndefined();
  });
});

describe('missingSystemPackages', () => {
  it('maps only the binaries this launch needs to Debian packages', () => {
    const none = () => false;
    expect(missingSystemPackages({ needXvfb: true, needCa: true, has: none })).toEqual(['xvfb', 'libnss3-tools']);
    expect(missingSystemPackages({ needXvfb: false, needCa: true, has: none })).toEqual(['libnss3-tools']);
    expect(missingSystemPackages({ needXvfb: true, needCa: true, has: () => true })).toEqual([]);
  });
});
