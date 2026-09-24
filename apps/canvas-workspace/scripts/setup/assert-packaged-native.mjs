import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const appRoot = fileURLToPath(new URL('../..', import.meta.url));
const packageNativeDir = join(appRoot, 'node_modules', '.cache', 'pulse-sqlite', 'package-native');
// electron-builder's Arch enum (builder-util): the hook receives the numeric value.
const ARCH_NAMES = ['ia32', 'x64', 'armv7l', 'arm64', 'universal'];

/**
 * prepare-sqlite-native.mjs builds for the host; the packaged app resolves its
 * binding by the target platform/arch. Refuse any package that would miss it.
 */
export async function assertPackagedNative({ platform, arch, directory = packageNativeDir }) {
  const bindings = await readdir(directory).then(
    names => names.filter(name => name.endsWith('.node')),
    error => {
      if (error?.code === 'ENOENT') return [];
      throw error;
    },
  );
  const expected = `${platform}-${arch}-`;
  if (bindings.length !== 1 || !bindings[0].startsWith(expected)) {
    throw new Error(
      `SQLite native binding for ${platform}/${arch} is missing (staged: ${bindings.join(', ') || 'none'}). `
      + 'The binding is built for the host architecture; package on a matching host.',
    );
  }
  return bindings[0];
}

export default async function beforePack(context) {
  await assertPackagedNative({
    platform: context.electronPlatformName,
    arch: ARCH_NAMES[context.arch] ?? String(context.arch),
  });
}
