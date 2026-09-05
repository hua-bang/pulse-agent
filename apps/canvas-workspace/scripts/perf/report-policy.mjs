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

const sharedDependencyFiles = new Set(['package.json', 'pnpm-workspace.yaml', 'pnpm-lock.yaml']);
const runtimeFiles = new Set([
  '.github/workflows/perf.yml',
  'apps/canvas-workspace/electron.vite.config.ts',
  'apps/canvas-workspace/src/main/index.ts',
]);
const runtimeDirectories = [
  'apps/canvas-workspace/perf',
  'apps/canvas-workspace/scripts/perf',
  'apps/canvas-workspace/src/main/app',
  'apps/canvas-workspace/src/main/webview',
  'apps/canvas-workspace/src/renderer/src/app/App',
  'apps/canvas-workspace/src/renderer/src/app/shell/Workbench',
  'apps/canvas-workspace/src/renderer/src/modules/canvas',
  'apps/canvas-workspace/src/renderer/src/hooks',
  'apps/canvas-workspace/src/renderer/src/perf',
];
const packageDirectories = [
  'apps/canvas-workspace/build',
  'apps/canvas-workspace/resources',
];
const within = (file, directory) => file === directory || file.startsWith(directory + '/');

export const classifyPerformanceChanges = ({
  paths = [],
  eventName = 'pull_request',
  performanceLabel = false,
}) => {
  if (eventName !== 'pull_request' || performanceLabel) return { runtime: true, packaging: true };
  const shared = paths.some((file) => sharedDependencyFiles.has(file));
  return {
    runtime: shared || paths.some((file) => runtimeFiles.has(file) ||
      runtimeDirectories.some((directory) => within(file, directory))),
    packaging: shared || paths.some((file) =>
      file === '.github/workflows/perf.yml' ||
      file === 'apps/canvas-workspace/package.json' ||
      file.startsWith('apps/canvas-workspace/electron-builder.') ||
      file.startsWith('apps/canvas-workspace/scripts/perf/package-') ||
      packageDirectories.some((directory) => within(file, directory))),
  };
};
