import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { resolveCaCertFile, splitPemCertificates, trustCaCertificates } from '../trust.mjs';

const pem = (body) => `-----BEGIN CERTIFICATE-----\n${body}\n-----END CERTIFICATE-----`;

const dirs = [];
const tempDir = () => {
  const dir = mkdtempSync(join(tmpdir(), 'harness-trust-'));
  dirs.push(dir);
  return dir;
};

afterEach(() => {
  while (dirs.length) rmSync(dirs.pop(), { recursive: true, force: true });
});

describe('resolveCaCertFile', () => {
  it('prefers --ca-cert over the environment', () => {
    expect(resolveCaCertFile({ 'ca-cert': '/a.pem' }, { PULSE_CANVAS_HARNESS_CA_CERT: '/b.pem' })).toBe('/a.pem');
    expect(resolveCaCertFile({}, { PULSE_CANVAS_HARNESS_CA_CERT: '/b.pem' })).toBe('/b.pem');
    expect(resolveCaCertFile({}, {})).toBeUndefined();
  });
});

describe('splitPemCertificates', () => {
  it('extracts every certificate block and ignores surrounding text', () => {
    const bundle = `# proxy\n${pem('AAAA')}\nnoise\n${pem('BBBB')}\n`;
    expect(splitPemCertificates(bundle)).toEqual([pem('AAAA'), pem('BBBB')]);
    expect(splitPemCertificates('no certs')).toEqual([]);
  });
});

describe('trustCaCertificates', () => {
  it('is a no-op when no CA file is requested', async () => {
    await expect(trustCaCertificates({ profile: 'temp', home: '/nowhere' })).resolves.toBe(0);
  });

  it('refuses profile=real so the real NSS trust store is never modified', async () => {
    await expect(trustCaCertificates({ profile: 'real', home: '/home/x', caFile: '/a.pem', platform: 'linux' }))
      .rejects.toThrow(/profile=real/);
  });

  it('is Linux-only', async () => {
    await expect(trustCaCertificates({ profile: 'temp', home: '/tmp/x', caFile: '/a.pem', platform: 'darwin' }))
      .rejects.toThrow(/Linux-only/);
  });

  it('rejects a file without certificates', async () => {
    const dir = tempDir();
    const file = join(dir, 'empty.pem');
    writeFileSync(file, 'nothing here');
    await expect(trustCaCertificates({ profile: 'temp', home: dir, caFile: file, platform: 'linux' }))
      .rejects.toThrow(/No PEM certificates/);
  });

  const hasTools = spawnSync('certutil', ['-H']).error === undefined
    && spawnSync('openssl', ['version']).status === 0;

  it.skipIf(!hasTools)('imports a real certificate into the profile HOME nssdb, idempotently', async () => {
    const dir = tempDir();
    const keyFile = join(dir, 'key.pem');
    const certFile = join(dir, 'ca.pem');
    const gen = spawnSync('openssl', [
      'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1',
      '-subj', '/CN=harness-test-ca', '-keyout', keyFile, '-out', certFile,
    ]);
    expect(gen.status).toBe(0);

    const home = join(dir, 'home');
    await expect(trustCaCertificates({ profile: 'temp', home, caFile: certFile })).resolves.toBe(1);
    await expect(trustCaCertificates({ profile: 'temp', home, caFile: certFile })).resolves.toBe(1);

    const list = spawnSync('certutil', ['-L', '-d', `sql:${join(home, '.pki', 'nssdb')}`], { encoding: 'utf-8' });
    expect(list.stdout).toMatch(/pulse-harness-ca-0\s+C,,/);
  });
});
