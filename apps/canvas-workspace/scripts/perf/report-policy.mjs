export const runtimeReportFailure = ({ bundleOnly, launchFailed, scenariosRan }) => {
  if (bundleOnly) return null;
  if (launchFailed) return 'application launch failed';
  if (!scenariosRan) return 'runtime scenarios did not run';
  return null;
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
