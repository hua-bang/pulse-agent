import { evaluatePolicyGate } from './metric-policy.mjs';

export const PACKAGE_METRIC_IDS = {
  dmgMB: 'package.dmg_mb',
  appUnpackedMiB: 'package.app_unpacked_mib',
  asarMiB: 'package.asar_mib',
  nativeUnpackedMiB: 'package.native_unpacked_mib',
  electronLocaleCount: 'package.electron_locale_count',
};

export const evaluatePackageGates = (metrics, baselines) => Object.entries(PACKAGE_METRIC_IDS)
  .map(([reportKey, id]) => {
    const policy = baselines?.policies?.[id];
    const evaluation = evaluatePolicyGate(policy?.gate, metrics?.[reportKey]);
    return {
      metric: id,
      value: metrics?.[reportKey] ?? null,
      pass: evaluation?.pass === true,
      limit: evaluation?.limit ?? null,
      operator: evaluation?.operator ?? null,
    };
  });
