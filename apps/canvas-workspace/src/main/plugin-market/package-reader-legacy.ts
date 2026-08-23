import { promises as fs } from 'fs';
import { join } from 'path';
import type {
  NormalizedPluginPackage,
  PluginPackageDiagnostic,
} from '../../shared/plugin-market';
import { readPulseExtension } from './package-reader-pulse';
import { readLegacySkills } from './package-reader-skills';
import {
  containedRealpath,
  diagnostic,
  errorMessage,
  isRecord,
  pathExists,
  readJson,
} from './package-reader-support';

export async function readLegacyPackage(
  root: string,
  diagnostics: PluginPackageDiagnostic[],
): Promise<NormalizedPluginPackage | null> {
  const candidate = join(root, 'manifest.json');
  let hasManifest: boolean;
  try {
    hasManifest = await pathExists(candidate);
  } catch (error) {
    diagnostics.push(diagnostic(
      'error', 'legacy-manifest', 'legacy-manifest.unreadable', errorMessage(error), candidate,
    ));
    return null;
  }
  if (!hasManifest) {
    diagnostics.push(diagnostic(
      'error',
      'package',
      'manifest.missing',
      'Plugin directory contains neither plugin.json nor legacy manifest.json',
      root,
    ));
    return null;
  }

  let manifestPath: string;
  let manifest: unknown;
  try {
    manifestPath = await containedRealpath(root, candidate);
    if (!(await fs.stat(manifestPath)).isFile()) throw new Error('manifest.json is not a regular file');
    manifest = await readJson(manifestPath);
  } catch (error) {
    diagnostics.push(diagnostic(
      'error', 'legacy-manifest', 'legacy-manifest.unreadable', errorMessage(error), candidate,
    ));
    return null;
  }

  if (!isRecord(manifest) || typeof manifest.id !== 'string' || !manifest.id.trim()) {
    diagnostics.push(diagnostic(
      'error',
      'legacy-manifest',
      'legacy-manifest.invalid',
      'Legacy manifest.json must be an object with a non-empty string id',
      manifestPath,
    ));
    return null;
  }
  if (manifest.version !== undefined && typeof manifest.version !== 'string') {
    diagnostics.push(diagnostic(
      'error', 'legacy-manifest', 'legacy-manifest.invalid', 'Legacy version must be a string', manifestPath,
    ));
    return null;
  }
  if (manifest.description !== undefined && typeof manifest.description !== 'string') {
    diagnostics.push(diagnostic(
      'error', 'legacy-manifest', 'legacy-manifest.invalid', 'Legacy description must be a string', manifestPath,
    ));
    return null;
  }

  const skills = await readLegacySkills(root, manifest.skills, diagnostics);
  const pulseExtension = await readPulseExtension(
    root,
    manifest,
    'legacy-manifest',
    diagnostics,
  );
  return {
    format: 'legacy-canvas',
    root,
    manifestPath,
    name: manifest.id.trim(),
    ...(typeof manifest.version === 'string' ? { version: manifest.version } : {}),
    ...(typeof manifest.description === 'string' ? { description: manifest.description } : {}),
    keywords: [],
    skills,
    ...(pulseExtension ? { pulseExtension } : {}),
  };
}
