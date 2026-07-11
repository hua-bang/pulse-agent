import { describe, expect, it } from 'vitest';
import { evaluatePackageGates } from './package-gates.mjs';

const baselines = {
  policies: {
    'package.dmg_mb': { gate: { kind: 'max', value: 100 } },
    'package.app_unpacked_mib': { gate: { kind: 'max', value: 250 } },
    'package.asar_mib': { gate: { kind: 'max', value: 50 } },
    'package.native_unpacked_mib': { gate: { kind: 'max', value: 5 } },
    'package.electron_locale_count': { gate: { kind: 'max', value: 3 } },
  },
};

describe('package performance Gates', () => {
  it('evaluates every packaged artifact metric', () => {
    const gates = evaluatePackageGates({
      dmgMB: 96.5,
      appUnpackedMiB: 234.9,
      asarMiB: 43.8,
      nativeUnpackedMiB: 2.3,
      electronLocaleCount: 3,
    }, baselines);

    expect(gates).toHaveLength(5);
    expect(gates.every((gate) => gate.pass)).toBe(true);
  });

  it('fails closed when a metric or Gate is unavailable', () => {
    const gates = evaluatePackageGates({ dmgMB: 96.5 }, baselines);

    expect(gates.find((gate) => gate.metric === 'package.dmg_mb')?.pass).toBe(true);
    expect(gates.filter((gate) => !gate.pass)).toHaveLength(4);
  });
});
