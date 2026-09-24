import { spawnSync } from 'node:child_process';
import { existsSync, promises as fs } from 'node:fs';
import { join } from 'node:path';
import { HarnessError } from './errors.mjs';

/**
 * Extra CA trust for the launched app's Chromium network stack.
 *
 * Behind a TLS-intercepting egress proxy (cloud sandboxes, corporate CI),
 * Node honours NODE_EXTRA_CA_CERTS but Chromium on Linux does not: it only
 * trusts the NSS database at `$HOME/.pki/nssdb`. Without this, every HTTPS
 * webview/guest fails with net_error -202 (ERR_CERT_AUTHORITY_INVALID).
 *
 * Opt-in via `--ca-cert <pem>` or PULSE_CANVAS_HARNESS_CA_CERT. The certs are
 * imported into the profile's own HOME, never the user's: profile=real is
 * refused so the harness cannot change a real browser trust store.
 */

const PEM_CERT = /-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g;

export const resolveCaCertFile = (opts, env = process.env) =>
  opts['ca-cert'] ?? env.PULSE_CANVAS_HARNESS_CA_CERT ?? undefined;

export const splitPemCertificates = (pem) => pem.match(PEM_CERT) ?? [];

const runCertutil = (args, input) => {
  const result = spawnSync('certutil', args, { input, encoding: 'utf-8' });
  if (result.error?.code === 'ENOENT') {
    throw new HarnessError(
      '--ca-cert needs NSS certutil (debian/ubuntu: `apt-get install -y libnss3-tools`).',
    );
  }
  if (result.status !== 0) {
    throw new HarnessError(`certutil ${args[0]} failed: ${(result.stderr || result.stdout).trim()}`);
  }
};

/** Returns the number of imported certificates, or 0 when not requested. */
export async function trustCaCertificates({ profile, home, caFile, platform = process.platform }) {
  if (!caFile) return 0;
  if (platform !== 'linux') {
    throw new HarnessError('--ca-cert is Linux-only (Chromium reads $HOME/.pki/nssdb there).');
  }
  if (profile === 'real') {
    throw new HarnessError('--ca-cert is refused for profile=real; it would modify your real NSS trust store.');
  }

  const pem = await fs.readFile(caFile, 'utf-8').catch((err) => {
    throw new HarnessError(`Cannot read --ca-cert ${caFile}: ${err.message}`);
  });
  const certs = splitPemCertificates(pem);
  if (!certs.length) throw new HarnessError(`No PEM certificates found in ${caFile}.`);

  const nssDir = join(home, '.pki', 'nssdb');
  const db = `sql:${nssDir}`;
  if (!existsSync(join(nssDir, 'cert9.db'))) {
    await fs.mkdir(nssDir, { recursive: true });
    runCertutil(['-N', '-d', db, '--empty-password']);
  }
  certs.forEach((cert, index) => {
    runCertutil(['-A', '-d', db, '-t', 'C,,', '-n', `pulse-harness-ca-${index}`], cert);
  });
  return certs.length;
}
