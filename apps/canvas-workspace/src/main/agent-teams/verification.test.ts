import { describe, expect, it } from 'vitest';
import { runTaskVerification } from './verification';

const nodeCommand = (source: string): string =>
  `${JSON.stringify(process.execPath)} -e ${JSON.stringify(source)}`;

describe('agent team task verification', () => {
  it('captures successful output and exit metadata', async () => {
    const result = await runTaskVerification(
      nodeCommand("process.stdout.write('verified')"),
      undefined,
      5_000,
    );

    expect(result).toMatchObject({ ok: true, exitCode: 0, outputTail: 'verified' });
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('combines stderr, reports failure, and caps the output tail', async () => {
    const result = await runTaskVerification(
      nodeCommand("process.stdout.write('x'.repeat(2100)); process.stderr.write('boom'); process.exit(3)"),
      undefined,
      5_000,
    );

    expect(result.ok).toBe(false);
    expect(result.exitCode).toBe(3);
    expect(result.outputTail).toHaveLength(2_000);
    expect(result.outputTail).toMatch(/boom$/);
  });
});
