export const runtimeReportFailure = ({ bundleOnly, launchFailed, scenariosRan }) => {
  if (bundleOnly) return null;
  if (launchFailed) return 'application launch failed';
  if (!scenariosRan) return 'runtime scenarios did not run';
  return null;
};

export const metricCoverageFailure = ({ bundleOnly, coverage }) => {
  if (bundleOnly) return null;
  if (!coverage) return 'metric coverage is unavailable';
  const { measured, total } = coverage;
  if (typeof measured !== 'number' || typeof total !== 'number') {
    return 'metric coverage is unavailable';
  }
  return measured < total ? `metric coverage is incomplete (${measured}/${total})` : null;
};

export const runFinalReportStep = ({
  bundleOnly,
  launchFailed,
  scenariosRan,
  gatesFailed,
  runDashboard,
}) => {
  const dashboardStatus = runDashboard();
  const runtimeFailure = runtimeReportFailure({ bundleOnly, launchFailed, scenariosRan });
  return {
    gatesFailed: gatesFailed || dashboardStatus !== 0 || runtimeFailure !== null,
    runtimeFailure,
  };
};
