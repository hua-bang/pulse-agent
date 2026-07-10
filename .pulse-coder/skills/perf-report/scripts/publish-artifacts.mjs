import { copyFileSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';

/** Keep optional deployed artifacts identical to the current local report. */
export const syncOptionalArtifacts = (sourceDir, targetDir, files) => {
  for (const file of files) {
    const source = join(sourceDir, file);
    const target = join(targetDir, file);
    rmSync(target, { force: true });
    if (existsSync(source)) copyFileSync(source, target);
  }
};
