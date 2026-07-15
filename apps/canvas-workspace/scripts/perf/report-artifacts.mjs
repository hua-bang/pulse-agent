import { existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const scenariosReportPath = (outDir) => join(outDir, 'scenarios-report.json');
const traceArtifactPaths = (outDir) => [
  join(outDir, 'renderer-trace-summary.json'),
  join(outDir, 'renderer-trace.json.gz'),
  join(outDir, 'panzoom-trace-summary.json'),
  join(outDir, 'panzoom-trace.json.gz'),
];
const generatedReportPaths = (outDir) => [
  join(outDir, 'bundle-report.json'),
  join(outDir, 'bundle-report.html'),
  join(outDir, 'dashboard.html'),
  join(outDir, 'report.json'),
  join(outDir, 'metrics-latest.json'),
  join(outDir, 'dashboard.png'),
  join(outDir, 'electron-startup.png'),
];

export const removeScenarioReportArtifact = (outDir) => {
  rmSync(scenariosReportPath(outDir), { force: true });
};

export const prepareReportArtifacts = (outDir) => {
  removeScenarioReportArtifact(outDir);
  for (const path of traceArtifactPaths(outDir)) rmSync(path, { force: true });
  for (const path of generatedReportPaths(outDir)) rmSync(path, { force: true });
};

export const runtimeScenariosExist = (outDir) => {
  const path = scenariosReportPath(outDir);
  if (!existsSync(path)) return false;
  try {
    const report = JSON.parse(readFileSync(path, 'utf-8'));
    return !!report?.scenarios && Object.keys(report.scenarios).length > 0;
  } catch {
    return false;
  }
};
