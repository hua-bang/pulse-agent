import { describe, expect, it } from 'vitest';
import { runFinalReportStep, runtimeReportFailure } from './report-policy.mjs';

describe('runtimeReportFailure', () => {
  it('rejects a full report when the app failed to launch', () => {
    expect(runtimeReportFailure({ bundleOnly: false, launchFailed: true, scenariosRan: false }))
      .toBe('application launch failed');
  });

  it('rejects a full report when runtime scenarios did not run', () => {
    expect(runtimeReportFailure({ bundleOnly: false, launchFailed: false, scenariosRan: false }))
      .toBe('runtime scenarios did not run');
  });

  it('accepts an explicit bundle-only report without runtime scenarios', () => {
    expect(runtimeReportFailure({ bundleOnly: true, launchFailed: false, scenariosRan: false }))
      .toBeNull();
  });

  it('accepts a full report after runtime scenarios run', () => {
    expect(runtimeReportFailure({ bundleOnly: false, launchFailed: false, scenariosRan: true }))
      .toBeNull();
  });
});

describe('runFinalReportStep', () => {
  it('runs the dashboard before rejecting an incomplete runtime report', () => {
    const calls = [];
    const result = runFinalReportStep({
      bundleOnly: false,
      launchFailed: true,
      scenariosRan: false,
      gatesFailed: false,
      runDashboard: () => {
        calls.push('dashboard');
        return 0;
      },
    });

    expect(calls).toEqual(['dashboard']);
    expect(result).toEqual({
      gatesFailed: true,
      runtimeFailure: 'application launch failed',
    });
  });

  it('includes a dashboard failure in the final gate state', () => {
    const result = runFinalReportStep({
      bundleOnly: true,
      launchFailed: false,
      scenariosRan: false,
      gatesFailed: false,
      runDashboard: () => 1,
    });

    expect(result).toEqual({ gatesFailed: true, runtimeFailure: null });
  });
});
