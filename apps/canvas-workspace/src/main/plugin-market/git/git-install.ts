import { promises as fs } from 'fs';
import { dirname, isAbsolute, join, relative, resolve } from 'path';
import type {
  NormalizedPluginPackage,
  PluginMarketMutationResult,
  PluginMarketSource,
  PluginPackageDiagnostic,
} from '../../../shared/plugin-market';
import { pluginMarketPackagesDir } from '../store';
import { assertManagedPackageTree, gitClone, normalizedGitSource } from './git-source';
import { readPluginPackage } from '../package-reader/reader';

function safeDirectoryName(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'plugin';
}

function isContained(root: string, target: string): boolean {
  const child = relative(root, target);
  return child === '' || (!child.startsWith('..') && !isAbsolute(child));
}

/** A failed rollback can leave this snapshot registered. Keep its files. */
export class RetainedGitPackageError extends Error {}

export async function installGitSource(
  sourceInput: PluginMarketSource,
  listingIdFor: (plugin: NormalizedPluginPackage, source: PluginMarketSource) => string,
  persistPackage: (listingId: string, source: PluginMarketSource, plugin: NormalizedPluginPackage,
    managed: boolean, diagnostics: PluginPackageDiagnostic[]) => Promise<PluginMarketMutationResult>,
): Promise<PluginMarketMutationResult> {
  const source = normalizedGitSource(sourceInput);
  const cloned = await gitClone(source);
  let destinationCreated = false;
  let destination: string | undefined;
  try {
    const initial = await readPluginPackage(cloned.packageDir);
    if (!initial.package) {
      return { ok: false, diagnostics: initial.diagnostics, error: 'Repository is not an installable plugin package' };
    }
    await assertManagedPackageTree(cloned.packageDir);
    const listingId = listingIdFor(initial.package, source);
    destination = join(
      pluginMarketPackagesDir(),
      safeDirectoryName(listingId),
      safeDirectoryName(cloned.commit),
    );
    try {
      await fs.access(destination);
    } catch {
      await fs.mkdir(dirname(destination), { recursive: true });
      destinationCreated = true;
      await fs.cp(cloned.packageDir, destination, {
        recursive: true,
        errorOnExist: true,
        filter: (source) => source !== join(cloned.packageDir, '.git'),
      });
    }
    const installed = await readPluginPackage(destination);
    if (!installed.package) {
      if (destinationCreated) await fs.rm(destination, { recursive: true, force: true });
      return { ok: false, diagnostics: installed.diagnostics, error: 'Copied plugin package failed validation' };
    }
    const result = await persistPackage(
      listingId,
      source,
      installed.package,
      true,
      installed.diagnostics,
    );
    if (!result.ok && destinationCreated) {
      await fs.rm(destination, { recursive: true, force: true });
      destinationCreated = false;
    }
    return result;
  } catch (error) {
    if (destinationCreated && destination && !(error instanceof RetainedGitPackageError)) {
      const packagesRoot = resolve(pluginMarketPackagesDir());
      const target = resolve(destination);
      if (target !== packagesRoot && isContained(packagesRoot, target)) {
        await fs.rm(target, { recursive: true, force: true }).catch(() => undefined);
      }
    }
    throw error;
  } finally {
    await fs.rm(cloned.stagingDir, { recursive: true, force: true });
  }
}
