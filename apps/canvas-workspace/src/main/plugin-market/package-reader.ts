import { promises as fs } from 'fs';
import { join, resolve } from 'path';
import {
  PULSE_CANVAS_EXTENSION_NAMESPACE,
  type NormalizedPluginPackage,
  type PluginPackageDiagnostic,
  type PluginPackageReadResult,
} from '../../shared/plugin-market';
import {
  containedRealpath,
  diagnostic,
  errorMessage,
  pathExists,
  readJson,
} from './package-reader-support';
import { validateAgentManifest } from './package-reader-manifest';
import { readLegacyPackage } from './package-reader-legacy';
import { readMcpComponent } from './package-reader-mcp';
import { readPulseExtension } from './package-reader-pulse';
import { discoverSkills } from './package-reader-skills';

export async function readPluginPackage(packageDir: string): Promise<PluginPackageReadResult> {
  const diagnostics: PluginPackageDiagnostic[] = [];
  let root: string;
  try {
    root = await fs.realpath(resolve(packageDir));
    if (!(await fs.stat(root)).isDirectory()) throw new Error('Plugin root is not a directory');
  } catch (error) {
    return {
      package: null,
      diagnostics: [diagnostic('error', 'package', 'package.invalid-root', errorMessage(error), resolve(packageDir))],
    };
  }

  const candidate = join(root, 'plugin.json');
  try {
    if (!await pathExists(candidate)) {
      return {
        package: await readLegacyPackage(root, diagnostics),
        diagnostics,
      };
    }
  } catch (error) {
    return {
      package: null,
      diagnostics: [diagnostic('error', 'manifest', 'manifest.unreadable', errorMessage(error), candidate)],
    };
  }
  let manifestPath: string;
  try {
    manifestPath = await containedRealpath(root, candidate);
    if (!(await fs.stat(manifestPath)).isFile()) throw new Error('plugin.json is not a regular file');
  } catch (error) {
    return {
      package: null,
      diagnostics: [diagnostic('error', 'manifest', 'manifest.unreadable', errorMessage(error), candidate)],
    };
  }

  let rawManifest: unknown;
  try {
    rawManifest = await readJson(manifestPath);
  } catch (error) {
    return {
      package: null,
      diagnostics: [diagnostic('error', 'manifest', 'manifest.invalid-json', errorMessage(error), manifestPath)],
    };
  }
  const manifest = validateAgentManifest(rawManifest, manifestPath, diagnostics);
  if (!manifest) return { package: null, diagnostics };

  const skills = await discoverSkills(root, diagnostics);
  const mcp = await readMcpComponent(root, diagnostics);
  const pulseExtension = await readPulseExtension(
    root,
    manifest.extensions?.[PULSE_CANVAS_EXTENSION_NAMESPACE],
    'plugin-extension',
    diagnostics,
  );
  const plugin: NormalizedPluginPackage = {
    format: 'agent-plugin',
    root,
    manifestPath,
    name: manifest.name,
    ...(manifest.version !== undefined ? { version: manifest.version } : {}),
    ...(manifest.description !== undefined ? { description: manifest.description } : {}),
    ...(manifest.author !== undefined ? { author: manifest.author } : {}),
    ...(manifest.homepage !== undefined ? { homepage: manifest.homepage } : {}),
    ...(manifest.repository !== undefined ? { repository: manifest.repository } : {}),
    ...(manifest.license !== undefined ? { license: manifest.license } : {}),
    keywords: manifest.keywords,
    skills,
    ...(mcp ? { mcp } : {}),
    ...(pulseExtension ? { pulseExtension } : {}),
  };
  return { package: plugin, diagnostics };
}
