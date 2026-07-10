import { existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const scenariosReportPath = (outDir) => join(outDir, 'scenarios-report.json');
const traceArtifactPaths = (outDir) => [
  join(outDir, 'renderer-trace-summary.json'),
  join(outDir, 'renderer-trace.json.gz'),
];

export const prepareReportArtifacts = (outDir) => {
  rmSync(scenariosReportPath(outDir), { force: true });
  for (const path of traceArtifactPaths(outDir)) rmSync(path, { force: true });
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
