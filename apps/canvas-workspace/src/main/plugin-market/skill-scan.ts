import { existsSync, readFileSync, realpathSync, readdirSync, statSync } from 'fs';
import { basename, join } from 'path';
import type { PluginPackageDiagnostic } from '../../shared/plugin-market';
import { validateAgentManifest } from './package-reader';
import { parseSkillMetadata } from './package-reader-skills';

function containedPath(root: string, candidate: string): string | undefined {
  try {
    const canonicalRoot = realpathSync(root);
    const canonical = realpathSync(candidate);
    const child = canonical.slice(canonicalRoot.length);
    if (canonical !== canonicalRoot && !child.startsWith('/') && !child.startsWith('\\')) return undefined;
    return canonical;
  } catch {
    return undefined;
  }
}

/** Undefined means this is not an Agent Plugins package; [] means v1 with no valid skills. */
export function agentPluginSkillScanPathsSync(dir: string): string[] | undefined {
  try {
    const manifestCandidate = join(dir, 'plugin.json');
    if (!existsSync(manifestCandidate)) return undefined;
    const manifestPath = containedPath(dir, manifestCandidate);
    if (!manifestPath || !statSync(manifestPath).isFile()) return [];
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as unknown;
    const diagnostics: PluginPackageDiagnostic[] = [];
    if (!validateAgentManifest(manifest, manifestPath, diagnostics)) return [];
    const skillsRoot = containedPath(dir, join(dir, 'skills'));
    if (!skillsRoot || !statSync(skillsRoot).isDirectory()) return [];
    return readdirSync(skillsRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() || entry.isSymbolicLink())
      .map((entry) => containedPath(dir, join(skillsRoot, entry.name)))
      .filter((path): path is string => Boolean(path && statSync(path).isDirectory()))
      .filter((path) => {
        const skill = containedPath(dir, join(path, 'SKILL.md'));
        if (!skill || !statSync(skill).isFile()) return false;
        return Boolean(parseSkillMetadata(readFileSync(skill, 'utf8'), basename(path)));
      });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    return [];
  }
}
