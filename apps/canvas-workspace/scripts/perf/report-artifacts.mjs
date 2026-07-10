import { existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const scenariosReportPath = (outDir) => join(outDir, 'scenarios-report.json');

export const prepareReportArtifacts = (outDir) => {
  rmSync(scenariosReportPath(outDir), { force: true });
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
